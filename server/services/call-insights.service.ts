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
  serviceOrRequirement?: string | null;
  propertyType?: string | null;
  budget?: string | null;
  location?: string | null;
  appointmentTiming?: string | null;
  leadDetails?: Record<string, string>;
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

const SYSTEM_PROMPT = `You are an expert multi-industry AI conversation analyst.
Analyze the voice call transcript (in Hindi, English, Hinglish, Punjabi, or any language) and extract structured insights and all business/lead details dynamically regardless of the industry (Healthcare, Real Estate, Religious/Pooja, Education/School, Political/Survey, E-commerce, Legal, Finance, Service/Booking, etc.).

Respond ONLY with valid JSON in this exact structure:
{
  "aiSummary": "2-3 sentence clear summary of the customer's request, conversation highlights, and current outcome",
  "customerName": "Customer / Caller / Yajman / Patient / Student / Voter name if mentioned, otherwise null",
  "serviceOrRequirement": "Specific service, requirement, doctor specialty, puja type, property, admission class, or query (e.g. 'Griha Pravesh Puja', 'Cardiology Consultation', '3 BHK Villa', 'Class 11 Science Admission', 'MLA Performance Feedback')",
  "leadDetails": {
    "<Specific Field Name 1>": "<Extracted Value 1>",
    "<Specific Field Name 2>": "<Extracted Value 2>"
  },
  "sentiment": "positive" | "neutral" | "negative",
  "classification": "hot" | "warm" | "cold" | "lost",
  "keyPoints": [
    "Customer Name: <Name>",
    "Phone Number: <Caller number>",
    "<Key Point 1>",
    "<Key Point 2>"
  ],
  "nextActions": [
    "Action item 1",
    "Action item 2"
  ]
}

Guidelines for "leadDetails":
Extract ALL relevant business fields discussed during the conversation as clean key-value pairs with proper capitalization.
Examples:
- Pooja / Religious: {"Puja Name": "गृह प्रवेश पूजा", "Yajman Name": "सुनील कुमार", "Gotra": "AITHAN", "Preferred Date / Muhurat": "शुभ मुहूर्त अनुसार", "City / Location": "जयपुर, निवाड़ू", "Mode": "Home Visit (पंडित जी घर पर)"}
- Healthcare / Hospital: {"Patient Name": "...", "Doctor / Specialty": "...", "Appointment Timing": "...", "Location": "..."}
- Real Estate: {"Property Type": "Villa", "Budget": "₹50 Lakh", "Preferred Location": "Jaipur", "Site Visit Timing": "Sunday 10:00 AM"}
- School / Education: {"Student Name": "...", "Parent Name": "...", "Class / Grade": "...", "Admission Status": "Interested"}
- Political / Survey: {"Respondent Name": "...", "Constituency": "Muktsar", "MLA Satisfaction": "Satisfied", "Candidate Preference": "..."}

Classification guide:
- "hot": Caller showed strong interest, requested visit/booking/appointment, ready to proceed
- "warm": Caller showed moderate interest, needs follow-up or confirmation
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
