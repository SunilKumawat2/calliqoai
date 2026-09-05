import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import "../landing.css";
import * as Flags from 'country-flag-icons/react/3x2';
import calliqoLogo from "../assets/images/calliqologo.png";

const countryMap: Record<string, { code: string; label: string; prefix: string }> = {
  "AF": { code: "AF", label: "Afghanistan", prefix: "+93" },
  "AL": { code: "AL", label: "Albania", prefix: "+355" },
  "DZ": { code: "DZ", label: "Algeria", prefix: "+213" },
  "AD": { code: "AD", label: "Andorra", prefix: "+376" },
  "AO": { code: "AO", label: "Angola", prefix: "+244" },
  "AG": { code: "AG", label: "Antigua and Barbuda", prefix: "+1-268" },
  "AR": { code: "AR", label: "Argentina", prefix: "+54" },
  "AM": { code: "AM", label: "Armenia", prefix: "+374" },
  "AU": { code: "AU", label: "Australia", prefix: "+61" },
  "AT": { code: "AT", label: "Austria", prefix: "+43" },
  "AZ": { code: "AZ", label: "Azerbaijan", prefix: "+994" },
  "BS": { code: "BS", label: "Bahamas", prefix: "+1-242" },
  "BH": { code: "BH", label: "Bahrain", prefix: "+973" },
  "BD": { code: "BD", label: "Bangladesh", prefix: "+880" },
  "BB": { code: "BB", label: "Barbados", prefix: "+1-246" },
  "BY": { code: "BY", label: "Belarus", prefix: "+375" },
  "BE": { code: "BE", label: "Belgium", prefix: "+32" },
  "BZ": { code: "BZ", label: "Belize", prefix: "+501" },
  "BJ": { code: "BJ", label: "Benin", prefix: "+229" },
  "BT": { code: "BT", label: "Bhutan", prefix: "+975" },
  "BO": { code: "BO", label: "Bolivia", prefix: "+591" },
  "BA": { code: "BA", label: "Bosnia and Herzegovina", prefix: "+387" },
  "BW": { code: "BW", label: "Botswana", prefix: "+267" },
  "BR": { code: "BR", label: "Brazil", prefix: "+55" },
  "BN": { code: "BN", label: "Brunei", prefix: "+673" },
  "BG": { code: "BG", label: "Bulgaria", prefix: "+359" },
  "BF": { code: "BF", label: "Burkina Faso", prefix: "+226" },
  "BI": { code: "BI", label: "Burundi", prefix: "+257" },
  "CV": { code: "CV", label: "Cabo Verde", prefix: "+238" },
  "KH": { code: "KH", label: "Cambodia", prefix: "+855" },
  "CM": { code: "CM", label: "Cameroon", prefix: "+237" },
  "CA": { code: "CA", label: "Canada", prefix: "+1" },
  "CF": { code: "CF", label: "Central African Republic", prefix: "+236" },
  "TD": { code: "TD", label: "Chad", prefix: "+235" },
  "CL": { code: "CL", label: "Chile", prefix: "+56" },
  "CN": { code: "CN", label: "China", prefix: "+86" },
  "CO": { code: "CO", label: "Colombia", prefix: "+57" },
  "KM": { code: "KM", label: "Comoros", prefix: "+269" },
  "CG": { code: "CG", label: "Congo", prefix: "+242" },
  "CD": { code: "CD", label: "Congo (DRC)", prefix: "+243" },
  "CR": { code: "CR", label: "Costa Rica", prefix: "+506" },
  "HR": { code: "HR", label: "Croatia", prefix: "+385" },
  "CU": { code: "CU", label: "Cuba", prefix: "+53" },
  "CY": { code: "CY", label: "Cyprus", prefix: "+357" },
  "CZ": { code: "CZ", label: "Czech Republic", prefix: "+420" },
  "DK": { code: "DK", label: "Denmark", prefix: "+45" },
  "DJ": { code: "DJ", label: "Djibouti", prefix: "+253" },
  "DM": { code: "DM", label: "Dominica", prefix: "+1-767" },
  "DO": { code: "DO", label: "Dominican Republic", prefix: "+1-809" },
  "EC": { code: "EC", label: "Ecuador", prefix: "+593" },
  "EG": { code: "EG", label: "Egypt", prefix: "+20" },
  "SV": { code: "SV", label: "El Salvador", prefix: "+503" },
  "GQ": { code: "GQ", label: "Equatorial Guinea", prefix: "+240" },
  "ER": { code: "ER", label: "Eritrea", prefix: "+291" },
  "EE": { code: "EE", label: "Estonia", prefix: "+372" },
  "SZ": { code: "SZ", label: "Eswatini", prefix: "+268" },
  "ET": { code: "ET", label: "Ethiopia", prefix: "+251" },
  "FJ": { code: "FJ", label: "Fiji", prefix: "+679" },
  "FI": { code: "FI", label: "Finland", prefix: "+358" },
  "FR": { code: "FR", label: "France", prefix: "+33" },
  "GA": { code: "GA", label: "Gabon", prefix: "+241" },
  "GM": { code: "GM", label: "Gambia", prefix: "+220" },
  "GE": { code: "GE", label: "Georgia", prefix: "+995" },
  "DE": { code: "DE", label: "Germany", prefix: "+49" },
  "GH": { code: "GH", label: "Ghana", prefix: "+233" },
  "GR": { code: "GR", label: "Greece", prefix: "+30" },
  "GD": { code: "GD", label: "Grenada", prefix: "+1-473" },
  "GT": { code: "GT", label: "Guatemala", prefix: "+502" },
  "GN": { code: "GN", label: "Guinea", prefix: "+224" },
  "GW": { code: "GW", label: "Guinea-Bissau", prefix: "+245" },
  "GY": { code: "GY", label: "Guyana", prefix: "+592" },
  "HT": { code: "HT", label: "Haiti", prefix: "+509" },
  "HN": { code: "HN", label: "Honduras", prefix: "+504" },
  "HU": { code: "HU", label: "Hungary", prefix: "+36" },
  "IS": { code: "IS", label: "Iceland", prefix: "+354" },
  "IN": { code: "IN", label: "India", prefix: "+91" },
  "ID": { code: "ID", label: "Indonesia", prefix: "+62" },
  "IR": { code: "IR", label: "Iran", prefix: "+98" },
  "IQ": { code: "IQ", label: "Iraq", prefix: "+964" },
  "IE": { code: "IE", label: "Ireland", prefix: "+353" },
  "IL": { code: "IL", label: "Israel", prefix: "+972" },
  "IT": { code: "IT", label: "Italy", prefix: "+39" },
  "JM": { code: "JM", label: "Jamaica", prefix: "+1-876" },
  "JP": { code: "JP", label: "Japan", prefix: "+81" },
  "JO": { code: "JO", label: "Jordan", prefix: "+962" },
  "KZ": { code: "KZ", label: "Kazakhstan", prefix: "+7" },
  "KE": { code: "KE", label: "Kenya", prefix: "+254" },
  "KI": { code: "KI", label: "Kiribati", prefix: "+686" },
  "KW": { code: "KW", label: "Kuwait", prefix: "+965" },
  "KG": { code: "KG", label: "Kyrgyzstan", prefix: "+996" },
  "LA": { code: "LA", label: "Laos", prefix: "+856" },
  "LV": { code: "LV", label: "Latvia", prefix: "+371" },
  "LB": { code: "LB", label: "Lebanon", prefix: "+961" },
  "LS": { code: "LS", label: "Lesotho", prefix: "+266" },
  "LR": { code: "LR", label: "Liberia", prefix: "+231" },
  "LY": { code: "LY", label: "Libya", prefix: "+218" },
  "LI": { code: "LI", label: "Liechtenstein", prefix: "+423" },
  "LT": { code: "LT", label: "Lithuania", prefix: "+370" },
  "LU": { code: "LU", label: "Luxembourg", prefix: "+352" },
  "MG": { code: "MG", label: "Madagascar", prefix: "+261" },
  "MW": { code: "MW", label: "Malawi", prefix: "+265" },
  "MY": { code: "MY", label: "Malaysia", prefix: "+60" },
  "MV": { code: "MV", label: "Maldives", prefix: "+960" },
  "ML": { code: "ML", label: "Mali", prefix: "+223" },
  "MT": { code: "MT", label: "Malta", prefix: "+356" },
  "MH": { code: "MH", label: "Marshall Islands", prefix: "+692" },
  "MR": { code: "MR", label: "Mauritania", prefix: "+222" },
  "MU": { code: "MU", label: "Mauritius", prefix: "+230" },
  "MX": { code: "MX", label: "Mexico", prefix: "+52" },
  "FM": { code: "FM", label: "Micronesia", prefix: "+691" },
  "MD": { code: "MD", label: "Moldova", prefix: "+373" },
  "MC": { code: "MC", label: "Monaco", prefix: "+377" },
  "MN": { code: "MN", label: "Mongolia", prefix: "+976" },
  "ME": { code: "ME", label: "Montenegro", prefix: "+382" },
  "MA": { code: "MA", label: "Morocco", prefix: "+212" },
  "MZ": { code: "MZ", label: "Mozambique", prefix: "+258" },
  "MM": { code: "MM", label: "Myanmar", prefix: "+95" },
  "NA": { code: "NA", label: "Namibia", prefix: "+264" },
  "NR": { code: "NR", label: "Nauru", prefix: "+674" },
  "NP": { code: "NP", label: "Nepal", prefix: "+977" },
  "NL": { code: "NL", label: "Netherlands", prefix: "+31" },
  "NZ": { code: "NZ", label: "New Zealand", prefix: "+64" },
  "NI": { code: "NI", label: "Nicaragua", prefix: "+505" },
  "NE": { code: "NE", label: "Niger", prefix: "+227" },
  "NG": { code: "NG", label: "Nigeria", prefix: "+234" },
  "NO": { code: "NO", label: "Norway", prefix: "+47" },
  "OM": { code: "OM", label: "Oman", prefix: "+968" },
  "PK": { code: "PK", label: "Pakistan", prefix: "+92" },
  "PW": { code: "PW", label: "Palau", prefix: "+680" },
  "PA": { code: "PA", label: "Panama", prefix: "+507" },
  "PG": { code: "PG", label: "Papua New Guinea", prefix: "+675" },
  "PY": { code: "PY", label: "Paraguay", prefix: "+595" },
  "PE": { code: "PE", label: "Peru", prefix: "+51" },
  "PH": { code: "PH", label: "Philippines", prefix: "+63" },
  "PL": { code: "PL", label: "Poland", prefix: "+48" },
  "PT": { code: "PT", label: "Portugal", prefix: "+351" },
  "QA": { code: "QA", label: "Qatar", prefix: "+974" },
  "RO": { code: "RO", label: "Romania", prefix: "+40" },
  "RU": { code: "RU", label: "Russia", prefix: "+7" },
  "RW": { code: "RW", label: "Rwanda", prefix: "+250" },
  "KN": { code: "KN", label: "Saint Kitts and Nevis", prefix: "+1-869" },
  "LC": { code: "LC", label: "Saint Lucia", prefix: "+1-758" },
  "VC": { code: "VC", label: "Saint Vincent and the Grenadines", prefix: "+1-784" },
  "WS": { code: "WS", label: "Samoa", prefix: "+685" },
  "SM": { code: "SM", label: "San Marino", prefix: "+378" },
  "ST": { code: "ST", label: "Sao Tome and Principe", prefix: "+239" },
  "SA": { code: "SA", label: "Saudi Arabia", prefix: "+966" },
  "SN": { code: "SN", label: "Senegal", prefix: "+221" },
  "RS": { code: "RS", label: "Serbia", prefix: "+381" },
  "SC": { code: "SC", label: "Seychelles", prefix: "+248" },
  "SL": { code: "SL", label: "Sierra Leone", prefix: "+232" },
  "SG": { code: "SG", label: "Singapore", prefix: "+65" },
  "SK": { code: "SK", label: "Slovakia", prefix: "+421" },
  "SI": { code: "SI", label: "Slovenia", prefix: "+386" },
  "SB": { code: "SB", label: "Solomon Islands", prefix: "+677" },
  "SO": { code: "SO", label: "Somalia", prefix: "+252" },
  "ZA": { code: "ZA", label: "South Africa", prefix: "+27" },
  "SS": { code: "SS", label: "South Sudan", prefix: "+211" },
  "ES": { code: "ES", label: "Spain", prefix: "+34" },
  "LK": { code: "LK", label: "Sri Lanka", prefix: "+94" },
  "SD": { code: "SD", label: "Sudan", prefix: "+249" },
  "SR": { code: "SR", label: "Suriname", prefix: "+597" },
  "SE": { code: "SE", label: "Sweden", prefix: "+46" },
  "CH": { code: "CH", label: "Switzerland", prefix: "+41" },
  "SY": { code: "SY", label: "Syria", prefix: "+963" },
  "TW": { code: "TW", label: "Taiwan", prefix: "+886" },
  "TJ": { code: "TJ", label: "Tajikistan", prefix: "+992" },
  "TZ": { code: "TZ", label: "Tanzania", prefix: "+255" },
  "TH": { code: "TH", label: "Thailand", prefix: "+66" },
  "TL": { code: "TL", label: "Timor-Leste", prefix: "+670" },
  "TG": { code: "TG", label: "Togo", prefix: "+228" },
  "TO": { code: "TO", label: "Tonga", prefix: "+676" },
  "TT": { code: "TT", label: "Trinidad and Tobago", prefix: "+1-868" },
  "TN": { code: "TN", label: "Tunisia", prefix: "+216" },
  "TR": { code: "TR", label: "Turkey", prefix: "+90" },
  "TM": { code: "TM", label: "Turkmenistan", prefix: "+993" },
  "TV": { code: "TV", label: "Tuvalu", prefix: "+688" },
  "UG": { code: "UG", label: "Uganda", prefix: "+256" },
  "UA": { code: "UA", label: "Ukraine", prefix: "+380" },
  "AE": { code: "AE", label: "United Arab Emirates", prefix: "+971" },
  "GB": { code: "GB", label: "United Kingdom", prefix: "+44" },
  "US": { code: "US", label: "United States", prefix: "+1" },
  "UY": { code: "UY", label: "Uruguay", prefix: "+598" },
  "UZ": { code: "UZ", label: "Uzbekistan", prefix: "+998" },
  "VU": { code: "VU", label: "Vanuatu", prefix: "+678" },
  "VE": { code: "VE", label: "Venezuela", prefix: "+58" },
  "VN": { code: "VN", label: "Vietnam", prefix: "+84" },
  "YE": { code: "YE", label: "Yemen", prefix: "+967" },
  "ZM": { code: "ZM", label: "Zambia", prefix: "+260" },
  "ZW": { code: "ZW", label: "Zimbabwe", prefix: "+263" }
};

const sortedCountries = Object.values(countryMap).sort((a, b) => a.label.localeCompare(b.label));


interface DemoAgent {
  id: string;
  name: string;
  telephonyProvider: string;
  type: string;
  engine: string;
}

interface LogLine {
  time: string;
  type: 'info' | 'success' | 'error' | 'warn';
  message: string;
}

export default function DemoPage() {
  const [agentsList, setAgentsList] = useState<DemoAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState<string>("twilio");
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [countryPrefix, setCountryPrefix] = useState<string>("+1");
  const [selectedCountry, setSelectedCountry] = useState<string>("CA");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [callStatus, setCallStatus] = useState<string>("idle"); // idle, connecting, ringing, active, completed, failed

  const [timerSeconds, setTimerSeconds] = useState<number>(0);

  // Active call tracking reference for hangup & race condition protection
  const activeCallRef = useRef<{ callId?: string; uuid?: string; provider?: string; twilioSid?: string } | null>(null);
  const isCancelledRef = useRef<boolean>(false);

  const [providerNumbers, setProviderNumbers] = useState<{ twilio: string | null; plivo: string | null }>({
    twilio: null,
    plivo: null
  });

  const selectedAgent = agentsList.find(a => a.id === selectedAgentId);
  const agentProvider = selectedAgent?.telephonyProvider || "";

  // Filter agents list based on selected provider route:
  // - "plivo" (Indian Number) -> Only Plivo + OpenAI agents
  // - "twilio" (International Number) -> Twilio + ElevenLabs / OpenAI agents
  const filteredAgents = agentsList.filter(agent => {
    if (selectedProvider === "plivo") {
      return agent.telephonyProvider.startsWith("plivo");
    }
    return !agent.telephonyProvider.startsWith("plivo");
  });

  // Fetch public demo agents and providers
  useEffect(() => {
    async function fetchAgents() {
      try {
        const response = await fetch("/api/public/demo-agents");
        const result = await response.json();
        if (result.success && result.agents) {
          setAgentsList(result.agents);
          if (result.agents.length > 0) {
            // Default to International route or first available agent
            const firstIntl = result.agents.find((a: DemoAgent) => !a.telephonyProvider.startsWith("plivo"));
            const defaultAgent = firstIntl || result.agents[0];
            setSelectedAgentId(defaultAgent.id);

            const isPlivo = defaultAgent.telephonyProvider.startsWith("plivo");
            setSelectedProvider(isPlivo ? "plivo" : "twilio");
            if (isPlivo) {
              setCountryPrefix("+91");
              setSelectedCountry("IN");
            } else {
              setCountryPrefix("+1");
              setSelectedCountry("CA");
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch demo agents:", error);
        addLog("error", "Failed to load voice agents from the server.");
      }
    }

    async function fetchProviders() {
      try {
        const response = await fetch("/api/public/demo-providers");
        const result = await response.json();
        if (result.success) {
          setProviderNumbers({
            twilio: result.twilio,
            plivo: result.plivo
          });
        }
      } catch (error) {
        console.error("Failed to fetch demo providers:", error);
      }
    }

    fetchAgents();
    fetchProviders();
  }, []);

  // Call timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (callStatus === "active") {
      setTimerSeconds(0);
      interval = setInterval(() => {
        setTimerSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setTimerSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callStatus]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const addLog = (type: LogLine['type'], message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, type, message }]);
  };

  const handleAgentChange = (value: string) => {
    setSelectedAgentId(value);
    const agent = agentsList.find(a => a.id === value);
    if (agent) {
      const isPlivo = agent.telephonyProvider.startsWith("plivo");
      const mappedProvider = isPlivo ? "plivo" : "twilio";
      setSelectedProvider(mappedProvider);
      if (mappedProvider === "plivo") {
        setCountryPrefix("+91");
        setSelectedCountry("IN");
      } else {
        setCountryPrefix("+1");
        setSelectedCountry("CA");
      }
      addLog("info", `Selected agent: ${agent.name} (${isPlivo ? 'National Call - PLIVO' : 'International Call - TWILIO'})`);
    }
  };

  const handleWorkflowChange = (provider: "twilio" | "plivo") => {
    setSelectedProvider(provider);
    if (provider === "plivo") {
      setCountryPrefix("+91");
      setSelectedCountry("IN");
      // Auto-select first Plivo agent if current agent is not Plivo
      const plivoAgents = agentsList.filter(a => a.telephonyProvider.startsWith("plivo"));
      if (plivoAgents.length > 0 && !plivoAgents.some(a => a.id === selectedAgentId)) {
        setSelectedAgentId(plivoAgents[0].id);
      }
    } else {
      setCountryPrefix("+1");
      setSelectedCountry("CA");
      // Auto-select first International agent if current agent is Plivo
      const intlAgents = agentsList.filter(a => !a.telephonyProvider.startsWith("plivo"));
      if (intlAgents.length > 0 && !intlAgents.some(a => a.id === selectedAgentId)) {
        setSelectedAgentId(intlAgents[0].id);
      }
    }
    addLog("info", `Switched route to ${provider === 'twilio' ? 'International Number (Twilio + ElevenLabs/OpenAI)' : 'Indian Number (Plivo + OpenAI)'}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId) {
      addLog("error", "Please select a voice agent.");
      return;
    }

    if (!phoneNumber) {
      addLog("error", "Please enter your phone number.");
      return;
    }

    let cleanPhoneInput = phoneNumber.trim().replace(/[^0-9]/g, "");
    let prefixDigits = countryPrefix.replace(/[^0-9]/g, "");

    let cleanPhone = "";
    if (cleanPhoneInput.startsWith(prefixDigits)) {
      cleanPhone = `+${cleanPhoneInput}`;
    } else {
      cleanPhone = `+${prefixDigits}${cleanPhoneInput}`;
    }

    if (cleanPhone.length < 10) {
      addLog("error", "Invalid phone number. Please check the number and try again.");
      return;
    }

    setIsLoading(true);
    setIsCalling(true);
    setCallStatus("connecting");
    setLogs([]);
    isCancelledRef.current = false;
    addLog("info", `Initiating outbound connection to ${cleanPhone}...`);
    addLog("info", `Target Agent ID: ${selectedAgentId}`);
    addLog("info", `Carrier Route: ${selectedProvider.toUpperCase()}`);

    try {
      const response = await fetch("/api/public/demo-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: selectedAgentId,
          telephonyProvider: selectedProvider,
          toNumber: cleanPhone,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to trigger call");
      }

      // Check if user clicked cancel/hangup while the call setup was in-flight
      if (isCancelledRef.current) {
        addLog("warn", "Call was cancelled by user during setup. Triggering immediate hangup.");
        fetch("/api/public/demo-hangup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callId: result.callId,
            uuid: result.uuid,
            provider: result.provider,
            twilioSid: result.twilioSid,
          }),
        }).catch(err => console.error("In-flight cancel hangup error:", err));

        setCallStatus("idle");
        setIsCalling(false);
        return;
      }

      // Store call details for hangup triggering
      activeCallRef.current = {
        callId: result.callId,
        uuid: result.uuid,
        provider: result.provider,
        twilioSid: result.twilioSid,
      };

      setCallStatus("ringing");
      addLog("success", `Server connection established!`);
      addLog("info", `Ringing customer device...`);

      // Poll status every 1.5s to detect when user picks up the call
      const pollInterval = setInterval(async () => {
        if (isCancelledRef.current || !activeCallRef.current) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const params = new URLSearchParams();
          if (result.uuid) params.append("uuid", result.uuid);
          if (result.callId) params.append("callId", result.callId);
          if (result.provider) params.append("provider", result.provider);
          if (result.twilioSid) params.append("twilioSid", result.twilioSid);

          const statusRes = await fetch(`/api/public/demo-call-status?${params.toString()}`);
          const statusData = await statusRes.json();

          if (statusData.isAnswered && !isCancelledRef.current) {
            clearInterval(pollInterval);
            setCallStatus("active");
            addLog("success", `Call Answered & Connected! AI Agent is speaking.`);
          } else if (statusData.isEnded) {
            clearInterval(pollInterval);
            setCallStatus("idle");
            setIsCalling(false);
          }
        } catch (e) {
          // ignore polling errors
        }
      }, 1500);

      // Fallback timer: If after 12s still ringing, auto-transition to active
      setTimeout(() => {
        clearInterval(pollInterval);
        setCallStatus((prev) => {
          if (prev === "ringing" && !isCancelledRef.current) {
            addLog("success", `Call Connected! AI Agent is speaking.`);
            return "active";
          }
          return prev;
        });
      }, 12000);

      setTimeout(() => {
        if (!isCancelledRef.current) {
          addLog("info", `Audio stream active. Transcripts syncing.`);
        }
      }, 15000);

      // Continuous status polling (every 2s) to detect when call naturally completes on carrier/flow
      const activePollInterval = setInterval(async () => {
        if (isCancelledRef.current || !activeCallRef.current) {
          clearInterval(activePollInterval);
          return;
        }

        try {
          const params = new URLSearchParams();
          if (result.uuid) params.append("uuid", result.uuid);
          if (result.callId) params.append("callId", result.callId);
          if (result.provider) params.append("provider", result.provider);
          if (result.twilioSid) params.append("twilioSid", result.twilioSid);

          const statusRes = await fetch(`/api/public/demo-call-status?${params.toString()}`);
          const statusData = await statusRes.json();

          if (statusData.isEnded) {
            clearInterval(activePollInterval);
            addLog("success", "Call session completed naturally.");
            activeCallRef.current = null;
            setCallStatus("idle");
            setIsCalling(false);
          }
        } catch (e) {
          // ignore polling errors
        }
      }, 2000);

    } catch (error: any) {
      setCallStatus("failed");
      addLog("error", `Error: ${error.message || "Failed to initiate call"}`);
      setTimeout(() => {
        setCallStatus("idle");
        setIsCalling(false);
      }, 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndCall = async () => {
    isCancelledRef.current = true;
    const callData = activeCallRef.current;
    activeCallRef.current = null;

    setIsCalling(false);
    setCallStatus("idle");
    setIsLoading(false);
    addLog("info", "Disconnecting/Cancelling call on carrier network...");

    if (callData) {
      try {
        await fetch("/api/public/demo-hangup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(callData),
        });
        addLog("success", "Call hung up / cancelled successfully on phone device.");
      } catch (err: any) {
        console.error("Failed to hang up call:", err);
        addLog("warn", "Call disconnect signal sent to gateway.");
      }
    }
  };

  return (
    <div className="calliqo-landing">
      <div className="demo-page">
        <div className="auth-grid"></div>
        <div className="demo-glow"></div>

        <main className="demo-main" style={{ paddingTop: '20px' }}>

          {/* ── Figma Heading Banner ── */}
          <div className="demo-intro-banner">
            <div className="demo-intro-left">
              <span className="demo-kicker">INTERACTIVE PLAYGROUND</span>
              <h1 className="demo-heading-primary">Hear the intelligence</h1>
              <h1 className="demo-heading-secondary">in every conversation.</h1>
            </div>
            <div className="demo-intro-right">
              <p>Configure an agent, enter a number, and simulate the CALLIQO AI calling experience.</p>
            </div>
          </div>

          <div className="demo-layout">

            <section className="demo-config">
              {callStatus === "connecting" || callStatus === "ringing" ? (
                /* ── State 2: Demo Call - Calling ── */
                <div className="demo-phone-active-card calling">
                  <div>
                    <div className="call-header-status ringing">Calling...</div>
                    <div className="call-phone-number">{phoneNumber || "+1 (681) 800-1234"}</div>
                    <div className="call-agent-subtitle">
                      {selectedProvider === 'plivo' ? 'National Call' : 'International Call'}
                    </div>
                  </div>

                  <div className="demo-call-avatar-wrap">
                    <div className="avatar-pulse-ring"></div>
                    <div className="avatar-pulse-ring"></div>
                    <div className="avatar-pulse-ring"></div>
                    <div className="demo-call-avatar-icon">
                      <img src={calliqoLogo} alt="CALLIQO Logo" />
                    </div>
                  </div>

                  <div className="demo-call-controls">
                    <button type="button" className="demo-control-btn" title="Speaker">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    </button>
                    <button type="button" className="demo-control-btn" title="Keypad">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                    </button>
                    <button type="button" className="demo-control-btn end-call-btn" title="End Call" onClick={handleEndCall}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="23" y1="1" x2="1" y2="23"></line></svg>
                    </button>
                  </div>
                </div>
              ) : callStatus === "active" ? (
                /* ── State 3: Demo Call - Connected ── */
                <div className="demo-phone-active-card connected">
                  <div>
                    <div className="call-header-status connected">
                      {formatTimer(timerSeconds)}</div>
                    <div className="call-phone-number">{phoneNumber || "+1 (681) 800-1234"}</div>
                    <div className="call-agent-subtitle">
                      {selectedProvider === 'plivo' ? 'National Call' : 'International Call'}
                    </div>
                  </div>

                  <div className="demo-call-avatar-wrap">
                    <div className="avatar-pulse-ring" style={{ borderColor: 'rgba(28, 209, 82, 0.8)' }}></div>
                    <div className="avatar-pulse-ring" style={{ animationDelay: '0.4s', borderColor: 'rgba(28, 209, 82, 0.6)' }}></div>
                    <div className="avatar-pulse-ring" style={{ animationDelay: '0.8s', borderColor: 'rgba(28, 209, 82, 0.4)' }}></div>
                    <div className="demo-call-avatar-icon">
                      <img src={calliqoLogo} alt="CALLIQO Logo" />
                    </div>
                  </div>

                  <div className="demo-call-controls">
                    <button type="button" className="demo-control-btn active-speaker" title="Speaker">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    </button>
                    <button type="button" className="demo-control-btn" title="Mute">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                    </button>
                    <button type="button" className="demo-control-btn end-call-btn" title="End Call" onClick={handleEndCall}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="23" y1="1" x2="1" y2="23"></line></svg>
                    </button>
                  </div>
                </div>
              ) : (
                /* ── State 1: Demo Call - Configure Form ── */
                <>
                  <div className="demo-section-head">
                    <div>
                      <h2>Configure your call</h2>
                      <p>Choose an agent and define where the conversation starts.</p>
                    </div>
                  </div>
                  <form id="demo-form" onSubmit={handleSubmit}>
                    <label>
                      AI voice agent
                      <div className="select-wrap">
                        <select
                          id="agent"
                          value={selectedAgentId}
                          onChange={(e) => handleAgentChange(e.target.value)}
                        >
                          {filteredAgents.map(agent => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                          {filteredAgents.length === 0 && (
                            <option value="" disabled>No agents found for this call route.</option>
                          )}
                        </select>
                      </div>
                    </label>

                    <label>
                      Call workflow
                      <div className="workflow-toggle-buttons">
                        <button
                          type="button"
                          className={`workflow-btn ${selectedProvider === 'twilio' ? 'active' : ''}`}
                          onClick={() => handleWorkflowChange('twilio')}
                        >
                          International Number
                        </button>
                        <button
                          type="button"
                          className={`workflow-btn ${selectedProvider === 'plivo' ? 'active' : ''}`}
                          onClick={() => handleWorkflowChange('plivo')}
                        >
                          Indian Number
                        </button>
                      </div>
                    </label>

                    <label>
                      Your Phone number
                      <div className="demo-phone">
                        <div className="flag-select-wrap">
                          <div className="flag-icon-display">
                            {(() => {
                              const FlagComponent = Flags[selectedCountry as keyof typeof Flags];
                              return FlagComponent ? <FlagComponent className="flag-img" /> : null;
                            })()}
                          </div>
                          <select
                            value={selectedCountry}
                            onChange={(e) => {
                              const code = e.target.value;
                              setSelectedCountry(code);
                              const prefix = countryMap[code]?.prefix || "+1";
                              setCountryPrefix(prefix);
                            }}
                            className="flag-select"
                          >
                            <option value="CA">Canada</option>
                            <option value="US">United States</option>
                            <option value="IN">India</option>
                            {sortedCountries
                              .filter(c => !["CA", "US", "IN"].includes(c.code))
                              .map(c => (
                                <option key={c.code} value={c.code}>{c.label} ({c.prefix})</option>
                              ))
                            }
                          </select>
                        </div>
                        <input
                          id="phone"
                          type="tel"
                          placeholder={countryPrefix === "+91" ? "+91 98765-43210" : `${countryPrefix} 123-456-7890`}
                          autoComplete="tel"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          required
                        />
                      </div>
                    </label>

                    <button className="call-start" type="submit" disabled={isLoading || agentsList.length === 0}>
                      <b>{isLoading ? "Initiating Call..." : "Start Demo Call"}</b>
                      <i>→</i>
                    </button>
                  </form>

                  <div className="demo-notice">
                    <div className="safe-checkbox-box">
                      <span className="safe-badge-icon">◆</span>
                    </div>
                    <p>
                      <strong>Safe demo environment</strong>
                      <small>No phone data to transferred or started</small>
                    </p>
                  </div>
                </>
              )}
            </section>

            <section className={`demo-console ${callStatus}`}>
              {/* <div className={`call-status ${callStatus}`}>
                <div className="status-orb">
                  <img src="/images/calliqologo.png" alt="CALLIQO Logo" className="brand-logo-img" />
                  <b></b>
                </div>
                <span className="status-label">
                  {callStatus === "idle" ? "READY" : callStatus.toUpperCase()}
                </span>
                <h2>
                  {callStatus === "idle" && "Ready when you are"}
                  {callStatus === "connecting" && "Connecting Gateway..."}
                  {callStatus === "ringing" && "Ringing Device..."}
                  {callStatus === "active" && "Call In Progress"}
                  {callStatus === "failed" && "Connection Failed"}
                  {callStatus === "completed" && "Call Completed"}
                </h2>
                <p>
                  {callStatus === "idle" && "Configure the call and press start to preview the experience."}
                  {callStatus === "connecting" && "Resolving route settings and starting VoIP channel."}
                  {callStatus === "ringing" && "VoIP packet sent to your phone. Answer to connect."}
                  {callStatus === "active" && "AI agent is speaking. You can talk to it normally."}
                  {callStatus === "failed" && "The carrier route was not able to trigger the call."}
                  {callStatus === "completed" && "The session ended successfully."}
                </p>
                <div className="call-timer">
                  {formatTimer(timerSeconds)}
                </div>
                {(callStatus === "active" || callStatus === "ringing" || callStatus === "connecting") && (
                  <button className="end-call" type="button" onClick={handleEndCall}>
                    End demo
                  </button>
                )}
              </div> */}

              <div className="demo-live-panels">
                <div className="dialer-panel">
                  <div className="console-head">
                    <span>DIALER LOG</span>
                    {/* <div>
                      <i style={{ background: '#ff5468', width: '15px', height: '15px', borderRadius: '50%' }}></i>
                      <i style={{ background: '#ffbf3f', width: '15px', height: '15px', borderRadius: '50%' }}></i>
                      <i style={{ background: '#46d9a2', width: '15px', height: '15px', borderRadius: '50%' }}></i>
                    </div> */}
                  </div>
                  <div className="log-feed">
                    {logs.length === 0 ? (
                      <p className="empty-log-msg">Waiting for demo initialization.....</p>
                    ) : (
                      logs.map((log, index) => {
                        const isSuccess = log.type === 'success';
                        const isError = log.type === 'error';
                        const isWarn = log.type === 'warn';

                        let icon = "ℹ";
                        if (isSuccess) icon = "✔";
                        else if (isError) icon = "✖";
                        else if (isWarn) icon = "⚠";

                        let colorClass = "";
                        if (isSuccess) colorClass = "log-success";
                        else if (isError) colorClass = "log-error";
                        else if (isWarn) colorClass = "log-warn";

                        return (
                          <div key={index} className={`log-row ${colorClass}`}>
                            <span className="log-time">[{log.time}]</span>
                            <span className="log-icon">{icon}</span>
                            <span className="log-message">{log.message}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
