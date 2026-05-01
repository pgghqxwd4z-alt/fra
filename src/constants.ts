import { TradingStrategy, BookInsight, FrameworkStep } from './types';

export const TRADING_STRATEGIES: TradingStrategy[] = [
  {
    id: 'smc',
    name: "Smart Money Concepts (SMC)",
    description: "Institutional order tracking and liquidity analysis based on the Inner Circle Trader (ICT) methodology.",
    difficulty: "Advanced",
    coreConcepts: ["Order Blocks", "Fair Value Gaps", "Liquidity Sweeps", "Market Structure Shifts"],
    source: "ICT / Institutional"
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
    name: "Institutional Overlay (Goldman Style)",
    description: "Macro-fundamental combined with quantitative technical analysis used by top-tier investment banks.",
    difficulty: "Advanced",
    coreConcepts: ["Liquidity Voids", "Central Bank Divergence", "Institutional S/R", "COT Data"],
    source: "Goldman Sachs Desk"
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
    source: "Mark Douglas / Douglas-Schwager Axis",
    description: "Initialize the probabilistic mindset. Accept that anything can happen on any individual trade.",
    details: ["Accepting Randomness", "Risk-First Mentality", "Outcome Detachment"]
  },
  {
    title: "Institutional Narrative",
    source: "Goldman Sachs Strategy",
    description: "Analyze central bank policy and institutional liquidity voids to find the 'True North' of the market.",
    details: ["Inter-market Flow", "Liquidity Voids", "Macro Divergence"]
  },
  {
    title: "Structural Framework",
    source: "SMC Mechanics",
    description: "Map the narrative of institutional positions on the high timeframe (HTF).",
    details: ["Order Blocks", "FVG Imbalances", "Institutional Flow"]
  },
  {
    title: "Tactical Execution",
    source: "Pure Price Action",
    description: "Identify the high-probability trigger at pre-defined institutional zones.",
    details: ["LTF Confirmation", "CHoCH/BOS", "Candlestick Triggers"]
  }
];
