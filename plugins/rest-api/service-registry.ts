import type { OutboundCallService } from '../../server/services/outbound-call-service';

export interface CallServices {
  OutboundCallService: typeof OutboundCallService;
  getCredentialForAgent: (agentId: string) => Promise<{ id: number; apiKey: string } | null>;
  PlivoCallService: { initiateCall: (params: any) => Promise<any> };
  TwilioOpenAICallService: { initiateCall: (params: any) => Promise<any> };
}

let _services: CallServices | null = null;

export function setCallServices(services: CallServices): void {
  _services = services;
}

export function getCallServices(): CallServices {
  if (!_services) {
    throw new Error('[REST API Plugin] Call services not initialized. Ensure services are injected at plugin registration.');
  }
  return _services;
}
