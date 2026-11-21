// Words Deepgram is told to expect (keyterm prompting): DNY's own names and the terms its calls use.
// Copied verbatim from Sales QA (SA/src/lib/transcription/vocabulary.ts), which runs the same model on
// the same company account; keep the two lists in step.

export const DNY_TERMS = [
  "DNY Hospitality",
  "PlateSpace",
  "Gritfox",
  "Bravas",
  "QSR",
  "cloud kitchen",
  "cafe",
  "franchise",
  "multi-outlet",
  "lakh",
  "crore",
  "square feet",
  "carpet area",
  "rent",
  "P&L",
  "menu",
  "vision call",
  "consultant",
  // Heard on real calls and misheard without a hint ("paid Puja", "Hungary", "Gorigau").
  "Petpooja",
  "POS",
  "food costing",
  "SOP",
  "Andheri",
  "Goregaon",
  "Malad",
  "Thane",
  "Bandra",
  "Powai",
  "Navi Mumbai",
  "Pune",
] as const;
