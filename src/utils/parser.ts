import { ChatMessage } from "../types";

export const parseRawText = (text: string): ChatMessage[] => {
  const messages: ChatMessage[] = [];
  const lines = text.split('\n');

  const pattern = /^\[?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\]?\s+-?\s*([^:]+):\s+(.*)$/i;

  lines.forEach((line, index) => {
    const match = line.match(pattern);
    if (match) {
      messages.push({
        id: `msg-${index}`,
        timestamp: match[1],
        sender: match[2].trim(),
        text: match[3].trim()
      });
    } else if (messages.length > 0 && line.trim() !== '') {
      messages[messages.length - 1].text += ' ' + line.trim();
    }
  });

  return messages;
};

export const generateSampleData = (): ChatMessage[] => {
  return [
    { id: '1', sender: "Chief Analyst", timestamp: "2024-06-12 09:00", text: "Looking at EURUSD. We just had a H4 Break of Structure (BOS) to the downside." },
    { id: '2', sender: "Junior Trader", timestamp: "2024-06-12 09:05", text: "I see it. Price is retracing into the supply zone order block. Should I short now?" },
    { id: '3', sender: "Senior Mentor", timestamp: "2024-06-12 09:10", text: "Remember Mark Douglas. Are you trading based on the pattern or are you afraid of missing out (FOMO)?" },
    { id: '4', sender: "Junior Trader", timestamp: "2024-06-12 09:12", text: "Honestly, I missed the last move and I'm feeling a bit anxious to recover." },
    { id: '5', sender: "Chief Analyst", timestamp: "2024-06-12 09:15", text: "Wait for the Change of Character (CHoCH) on the M15 before entry. We need institutional flow confirmation." },
    { id: '6', sender: "Senior Mentor", timestamp: "2024-06-12 09:20", text: "Market Wizards rule #1: If you're stressed, you're trading too big. What's your risk on this setup?" },
    { id: '7', sender: "Junior Trader", timestamp: "2024-06-12 09:25", text: "0.5% of account. I'll wait for the M15 CHoCH at the Goldman structural level." },
    { id: '8', sender: "Chief Analyst", timestamp: "2024-06-12 09:45", text: "Price hit the liquidity grab. Entry triggered on M15. Stop loss above the high." }
  ];
};
