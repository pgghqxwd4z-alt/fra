import { TradingStrategy, BookInsight, FrameworkStep } from './types';

export const TRADING_STRATEGIES: TradingStrategy[] = [
  {
    id: 'smc',
    name: "Smart Money Concepts",
    description: "Liquidity and market-structure analysis used to forecast the next price leg and identify conditional execution zones.",
    difficulty: "Advanced",
    coreConcepts: [
      "Liquidity Pools",
      "Liquidity Sweeps",
      "Order Blocks",
      "Fair Value Gaps",
      "Displacement",
      "BOS / CHoCH",
      "Next-Move Forecast"
    ],
    source: "SMC / ICT"
  },
  {
    id: 'ppa',
    name: "Pure Price Action",
    description: "Trading based purely on historical price movement and candlestick patterns without lagging indicators.",
    difficulty: "Beginner",
    coreConcepts: ["Support & Resistance", "Trendlines", "Engulfing Candles", "Supply & Demand"],
    source: "Classic Price Action"
  },
  {
    id: 'gs',
    name: "Institutional / Macro Overlay",
    description: "Macro and liquidity analysis used to establish directional context and probabilistic price targets.",
    difficulty: "Advanced",
    coreConcepts: [
      "Liquidity Voids",
      "Macro Flow",
      "Institutional Zones",
      "Inter-market Pressure",
      "Directional Bias"
    ],
    source: "Institutional Analysis"
  }
];

export const BOOK_INSIGHTS: BookInsight[] = [
  {
    title: "Trading in the Zone",
    author: "Mark Douglas",
    keyThemes: ["Probabilistic Thinking", "Risk Management", "Consistency", "State of the Zone"],
    summary: "The definitive guide to the psychology of trading. Teaches you how to think in probabilities and manage expectations.",
    icon: "brain"
  },
  {
    title: "The Disciplined Trader",
    author: "Mark Douglas",
    keyThemes: ["Emotional Control", "Self-Discipline", "Belief Systems", "Internal Limits"],
    summary: "Explores the psychological requirements to successfully transition from retail mentality to professional market discipline.",
    icon: "shield-halved"
  },
  {
    title: "Market Wizards",
    author: "Jack D. Schwager",
    keyThemes: ["Elite Mindsets", "Risk Control", "System Fidelity", "Discipline"],
    summary: "Interviews with legendary traders revealing that risk management and discipline are more important than entry methods.",
    icon: "crown"
  }
];

export const FRAMEWORK_STEPS: FrameworkStep[] = [
  {
    title: "Psychological Foundation",
    source: "Douglas / Schwager",
    description: "Establish probabilistic thinking and eliminate the need to predict with certainty.",
    details: ["Accept Uncertainty", "Risk First", "Outcome Detachment", "System Discipline"]
  },
  {
    title: "Institutional Narrative",
    source: "Institutional / Macro Overlay",
    description: "Determine the broader directional pressure and identify areas where liquidity may attract price.",
    details: ["Macro Flow", "Liquidity Voids", "Inter-market Pressure", "Higher-Timeframe Bias"]
  },
  {
    title: "Liquidity Mapping",
    source: "SMC",
    description: "Map buy-side and sell-side liquidity and determine which liquidity remains available to price.",
    details: ["Buy-side Liquidity", "Sell-side Liquidity", "Liquidity Pools", "Sweeps"]
  },
  {
    title: "Structural Framework",
    source: "SMC Mechanics",
    description: "Identify the structural zones capable of producing the next displacement.",
    details: ["Order Blocks", "FVG", "BOS", "CHoCH", "Displacement"]
  },
  {
    title: "Forward Forecast",
    source: "QuantSage Forecast Engine",
    description: "Convert current structure and liquidity into a probabilistic forecast of the next price path.",
    details: ["Next Move", "Liquidity Target", "Expected Retracement", "Scenario Probability"]
  },
  {
    title: "Tactical Execution",
    source: "Pure Price Action",
    description: "Wait for confirmation at the forecasted institutional zone before considering execution.",
    details: ["LTF Confirmation", "Entry Zone", "Risk", "Invalidation", "Targets"]
  }
];
