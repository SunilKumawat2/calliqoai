'use strict';
/**
 * CallInsightsService - AI-powered call transcript analysis
 * 
 * Uses OpenAI Chat Completions API to analyze call transcripts
 * and generate structured insights including sentiment, classification,
 * key points, and recommended next actions.
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger';

export interface CallInsights {
  aiSummary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  classification: 'hot' | 'warm' | 'cold' | 'lost';
  customerName?: string | null;
  propertyType?: string | null;
  budget?: string | null;
  location?: string | null;
  appointmentTiming?: string | null;
  keyPoints?: string[];
  nextActions?: string[];
}

export interface CallMetadata {
  callId: string;
  fromNumber?: string;
  toNumber?: string;
  agentName?: string;
  duration?: number;
}

const SYSTEM_PROMPT = `You are an expert AI call analyst. Analyze the call conversation transcript (Hindi, English, or Hinglish) and extract structured insights and captured lead details dynamically.

Respond ONLY with valid JSON in this exact format:
{
  "aiSummary": "2-3 sentence clear summary of the customer conversation, requirement, and outcome",
  "customerName": "Customer name if mentioned in transcript, otherwise null",
  "propertyType": "Property or service type (e.g. 2BHK Flat, Villa, Plot, Clinic Consultation, Puja Booking) or null",
  "budget": "Customer budget (e.g. ₹50 Lakh) or null",
  "location": "Preferred location or city or null",
  "appointmentTiming": "Site visit or appointment date/time (e.g. Sunday 10:00 AM) or null",
  "sentiment": "positive" | "neutral" | "negative",
  "classification": "hot" | "warm" | "cold" | "lost",
  "keyPoints": [
    "Customer Name: <Name if mentioned>",
    "Phone Number: <Caller phone number>",
    "Requirement: ...",
    "Budget: ...",
    "Location: ...",
    "Site Visit / Timing: ..."
  ],
  "nextActions": [
    "recommended action 1",
    "recommended action 2"
  ]
}

Classification guide:
- "hot": Caller showed strong interest, requested visit/booking, ready to proceed
- "warm": Caller showed moderate interest, needs follow-up
- "cold": Caller showed little interest, unlikely to convert
- "lost": Caller explicitly declined or hung up early

Sentiment guide:
- "positive": Friendly, cooperative tone, expressed interest
- "neutral": Matter-of-fact tone
- "negative": Frustrated, complained, or hostile`;

import { OpenAIPoolService } from '../engines/plivo/services/openai-pool.service';

export class CallInsightsService {
  private static openai: OpenAI | null = null;

  private static async getOpenAIClient(apiKey?: string): Promise<OpenAI> {
    // If a specific API key is provided, create a new client for it
    if (apiKey) {
      return new OpenAI({ apiKey });
    }
    
    // Try to get active credential from OpenAI Pool Service
    try {
      const poolCred = await OpenAIPoolService.getAvailableCredential();
      if (poolCred?.apiKey) {
        return new OpenAI({ apiKey: poolCred.apiKey });
      }
    } catch (poolErr) {
      // Fall through to env
    }

    // Otherwise use the cached client with env var
    const envApiKey = process.env.OPENAI_API_KEY;
    if (envApiKey) {
      return new OpenAI({ apiKey: envApiKey });
    }
    
    throw new Error('No OpenAI API key available in Pool or Environment');
  }

  static async analyzeTranscript(
    transcript: string,
    metadata: CallMetadata,
    apiKey?: string
  ): Promise<CallInsights | null> {
    const source = 'CallInsightsService';
    
    if (!transcript || transcript.trim().length === 0) {
      logger.warn('Empty transcript provided for analysis', { callId: metadata.callId }, source);
      return null;
    }

    try {
      const openai = await this.getOpenAIClient(apiKey);
      
      const userMessage = this.buildUserMessage(transcript, metadata);
      
      logger.info(`Analyzing transcript for call ${metadata.callId}`, {
        transcriptLength: transcript.length,
        duration: metadata.duration
      }, source);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        logger.error('Empty response from OpenAI', { callId: metadata.callId }, source);
        return null;
      }

      const insights = JSON.parse(content) as CallInsights;
      
      if (!this.validateInsights(insights)) {
        logger.error('Invalid insights structure from OpenAI', { callId: metadata.callId, content }, source);
        return null;
      }

      // Dynamically guarantee Customer Name and Phone Number in keyPoints
      const keyPoints = Array.isArray(insights.keyPoints) ? [...insights.keyPoints] : [];
      if (insights.customerName && !keyPoints.some(kp => kp.toLowerCase().includes('customer name') || kp.toLowerCase().startsWith('name:'))) {
        keyPoints.unshift(`Customer Name: ${insights.customerName}`);
      }
      if (metadata.fromNumber && !keyPoints.some(kp => kp.toLowerCase().includes('phone') || kp.toLowerCase().includes('number:'))) {
        const nameIdx = keyPoints.findIndex(kp => kp.toLowerCase().includes('customer name') || kp.toLowerCase().startsWith('name:'));
        if (nameIdx !== -1) {
          keyPoints.splice(nameIdx + 1, 0, `Phone Number: ${metadata.fromNumber}`);
        } else {
          keyPoints.unshift(`Phone Number: ${metadata.fromNumber}`);
        }
      }
      insights.keyPoints = keyPoints;

      logger.info(`Successfully analyzed call ${metadata.callId}`, {
        sentiment: insights.sentiment,
        classification: insights.classification,
        customerName: insights.customerName,
        phone: metadata.fromNumber
      }, source);

      return insights;

    } catch (error: any) {
      logger.error(`Failed to analyze transcript for call ${metadata.callId}`, {
        error: error.message,
        code: error.code
      }, source);
      return null;
    }
  }

  private static buildUserMessage(transcript: string, metadata: CallMetadata): string {
    let message = '';
    
    if (metadata.agentName) {
      message += `Agent: ${metadata.agentName}\n`;
    }
    if (metadata.fromNumber) {
      message += `Caller: ${metadata.fromNumber}\n`;
    }
    if (metadata.duration) {
      message += `Duration: ${Math.floor(metadata.duration / 60)}m ${metadata.duration % 60}s\n`;
    }
    if (message) {
      message += '\n';
    }
    
    message += `Transcript:\n${transcript}`;
    
    return message;
  }

  private static validateInsights(insights: any): insights is CallInsights {
    if (!insights || typeof insights !== 'object') {
      return false;
    }
    
    if (typeof insights.aiSummary !== 'string' || insights.aiSummary.length === 0) {
      return false;
    }
    
    const validSentiments = ['positive', 'neutral', 'negative'];
    if (!validSentiments.includes(insights.sentiment)) {
      return false;
    }
    
    const validClassifications = ['hot', 'warm', 'cold', 'lost'];
    if (!validClassifications.includes(insights.classification)) {
      return false;
    }
    
    if (insights.keyPoints !== undefined && !Array.isArray(insights.keyPoints)) {
      return false;
    }
    
    if (insights.nextActions !== undefined && !Array.isArray(insights.nextActions)) {
      return false;
    }
    
    return true;
  }
}
