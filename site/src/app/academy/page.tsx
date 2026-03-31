"use client";

import { useState } from "react";

// ═══════════════════════════════════════════════════════════════
// Ghost Protocol Academy — Internes Weiterbildungsmodul
// Erstellt durch DONNA (Chief of Staff) am 31.03.2026
// ═══════════════════════════════════════════════════════════════

interface TrainingModule {
  agentId: string;
  agentName: string;
  role: string;
  tier: number;
  tierColor: string;
  kernkompetenzen: string[];
  pflichtlektuere: { titel: string; autor: string; jahr: number; relevanz: string }[];
  crossTraining: { partner: string; thema: string }[];
  pruefungsfragen: string[];
  lernpfad: { stufe: string; kriterien: string[] }[];
}

const TRAINING_DATA: TrainingModule[] = [
  {
    agentId: "strategist",
    agentName: "THE STRATEGIST",
    role: "CEO & Chief Strategist",
    tier: 0,
    tierColor: "#f43f5e",
    kernkompetenzen: [
      "OKR-Framework (John Doerr) — Quartalsziele mit messbaren Key Results",
      "Blue Ocean Strategy (Kim & Mauborgne) — Value Innovation, Strategy Canvas",
      "Porter's Five Forces — Branchenattraktivität und Wettbewerbsanalyse",
      "Wardley Mapping (Simon Wardley) — Situational Awareness durch Komponentenlandkarten",
      "First Principles Thinking — Grundannahmen hinterfragen statt Analogie-Denken",
      "OODA Loop (John Boyd) — Schnellere Entscheidungszyklen als Wettbewerber",
    ],
    pflichtlektuere: [
      { titel: "Measure What Matters", autor: "John Doerr", jahr: 2018, relevanz: "OKR-Implementierung" },
      { titel: "Blue Ocean Strategy", autor: "Kim & Mauborgne", jahr: 2005, relevanz: "Marktpositionierung" },
      { titel: "Competitive Strategy", autor: "Michael Porter", jahr: 1980, relevanz: "Wettbewerbsanalyse" },
      { titel: "The Lean Startup", autor: "Eric Ries", jahr: 2011, relevanz: "Build-Measure-Learn" },
      { titel: "Zero to One", autor: "Peter Thiel", jahr: 2014, relevanz: "Monopol-Denken" },
      { titel: "Good to Great", autor: "Jim Collins", jahr: 2001, relevanz: "Level 5 Leadership" },
    ],
    crossTraining: [
      { partner: "TREASURER", thema: "Unit Economics & Financial Modelling" },
      { partner: "ORACLE", thema: "Market Intelligence Interpretation" },
      { partner: "PUBLISHER", thema: "Brand Strategy & Category Design" },
    ],
    pruefungsfragen: [
      "Erklaere den Unterschied zwischen Type-1 und Type-2 Entscheidungen nach Bezos.",
      "Wie wuerde ein Strategy Canvas fuer Ghost Protocol vs. Wettbewerber aussehen?",
      "Definiere 3 OKRs fuer Q2 2026 mit je 3 messbaren Key Results.",
      "Wann ist Blue Ocean Strategy besser als Wettbewerbsstrategie nach Porter?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["OKRs formulieren koennen", "SWOT-Analyse durchfuehren", "Lean Startup Basics"] },
      { stufe: "Senior", kriterien: ["Wardley Maps erstellen", "Blue Ocean Strategien entwickeln", "Scenario Planning"] },
      { stufe: "Expert", kriterien: ["Portfolio-Strategien (BCG Matrix)", "M&A-Bewertungen", "Disruption Theory anwenden"] },
    ],
  },
  {
    agentId: "donna",
    agentName: "DONNA",
    role: "Chief of Staff",
    tier: 0,
    tierColor: "#f43f5e",
    kernkompetenzen: [
      "Scrum & Kanban — Sprint Planning, WIP-Limits, Flow-Management",
      "RACI-Matrix — Rollenklarheit bei jeder Aufgabe",
      "Theory of Constraints (Goldratt) — Bottleneck-Management",
      "Pyramid Principle (Barbara Minto) — Top-down Kommunikation",
      "SECI-Modell (Nonaka & Takeuchi) — Wissenstransformation",
      "GTD (David Allen) — Capture, Clarify, Organize, Reflect, Engage",
    ],
    pflichtlektuere: [
      { titel: "The Goal", autor: "Eliyahu Goldratt", jahr: 1984, relevanz: "Theory of Constraints" },
      { titel: "Scrum Guide", autor: "Schwaber & Sutherland", jahr: 2020, relevanz: "Agile Methodik" },
      { titel: "The Pyramid Principle", autor: "Barbara Minto", jahr: 1987, relevanz: "Strukturierte Kommunikation" },
      { titel: "Getting Things Done", autor: "David Allen", jahr: 2001, relevanz: "Produktivitaetssystem" },
      { titel: "Radical Candor", autor: "Kim Scott", jahr: 2017, relevanz: "Feedback-Kultur" },
    ],
    crossTraining: [
      { partner: "STRATEGIST", thema: "OKR-Kaskadierung & Priorisierung" },
      { partner: "OPERATOR", thema: "Operations-Metriken & Capacity Planning" },
      { partner: "GUARDIAN", thema: "Incident Management & Eskalation" },
    ],
    pruefungsfragen: [
      "Erstelle eine RACI-Matrix fuer einen Produktlaunch mit 5 Agents.",
      "Wie identifizierst du den Bottleneck in einem 4-Agent-Workflow?",
      "Erklaere den Unterschied zwischen Push- und Pull-System im Kanban.",
      "Formuliere ein After-Action-Review fuer ein gescheitertes Deployment.",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["Kanban-Board fuehren", "Meeting-Protokolle", "Task-Tracking"] },
      { stufe: "Senior", kriterien: ["RACI fuer komplexe Projekte", "TOC anwenden", "Stakeholder-Management"] },
      { stufe: "Expert", kriterien: ["Organisationsdesign", "Change Management", "Wissensmanagement-Systeme"] },
    ],
  },
  {
    agentId: "oracle",
    agentName: "ORACLE",
    role: "Chief Intelligence Officer",
    tier: 1,
    tierColor: "#8b5cf6",
    kernkompetenzen: [
      "SCIP Intelligence Cycle — Planning, Collection, Analysis, Dissemination",
      "TAM/SAM/SOM — Marktgroessen-Quantifizierung",
      "Bayessche Analyse — Probabilistisches Denken",
      "Scenario Planning (Shell-Methode) — 2x2 Unsicherheitsmatrix",
      "Technology Radar (ThoughtWorks) — Adopt, Trial, Assess, Hold",
      "Sherman Kent Methodology — Words of Estimative Probability",
    ],
    pflichtlektuere: [
      { titel: "Competitive Intelligence", autor: "Benjamin Gilad", jahr: 2003, relevanz: "War Gaming" },
      { titel: "Superforecasting", autor: "Philip Tetlock", jahr: 2015, relevanz: "Probabilistische Prognosen" },
      { titel: "The Signal and the Noise", autor: "Nate Silver", jahr: 2012, relevanz: "Dateninterpretation" },
      { titel: "Thinking, Fast and Slow", autor: "Daniel Kahneman", jahr: 2011, relevanz: "Kognitive Biases" },
    ],
    crossTraining: [
      { partner: "RESEARCHER", thema: "Deep-Dive Recherchemethodik" },
      { partner: "TRADER", thema: "Quantitative Marktdatenanalyse" },
      { partner: "STRATEGIST", thema: "Strategische Entscheidungsfindung" },
    ],
    pruefungsfragen: [
      "Berechne TAM/SAM/SOM fuer einen AI Content Repurposer im DACH-Markt.",
      "Erstelle 4 Szenarien fuer die AI-SaaS-Branche in 2027 (2x2 Matrix).",
      "Was bedeutet 'Moderate Confidence' nach Sherman Kent Methodology?",
      "Wie unterscheidest du Weak Signals von Noise?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["SWOT/PESTEL durchfuehren", "Grundlegende Marktrecherche", "Quellenbewertung"] },
      { stufe: "Senior", kriterien: ["TAM/SAM/SOM Bottom-Up", "Competitor Response Profiles", "Bayessche Updates"] },
      { stufe: "Expert", kriterien: ["War Gaming leiten", "Monte-Carlo Business-Prognosen", "Intelligence Briefings"] },
    ],
  },
  {
    agentId: "architect",
    agentName: "ARCHITECT",
    role: "Chief Technology Officer",
    tier: 1,
    tierColor: "#8b5cf6",
    kernkompetenzen: [
      "Clean Architecture (Robert C. Martin) — Dependency Rule",
      "Domain-Driven Design (Eric Evans) — Bounded Contexts, Aggregates",
      "12-Factor App (Heroku) — Cloud-native Prinzipien",
      "OWASP Top 10 — Web-Sicherheitsrisiken",
      "C4-Modell (Simon Brown) — Context, Container, Component, Code",
      "CAP-Theorem (Brewer) — Consistency, Availability, Partition Tolerance",
    ],
    pflichtlektuere: [
      { titel: "Clean Architecture", autor: "Robert C. Martin", jahr: 2017, relevanz: "Software-Architektur" },
      { titel: "Domain-Driven Design", autor: "Eric Evans", jahr: 2003, relevanz: "DDD" },
      { titel: "Designing Data-Intensive Applications", autor: "Martin Kleppmann", jahr: 2017, relevanz: "Verteilte Systeme" },
      { titel: "Building Microservices", autor: "Sam Newman", jahr: 2021, relevanz: "Microservice-Architektur" },
      { titel: "System Design Interview", autor: "Alex Xu", jahr: 2020, relevanz: "System Design" },
    ],
    crossTraining: [
      { partner: "GUARDIAN", thema: "SRE-Prinzipien & Observability" },
      { partner: "SCRIBE", thema: "Developer Experience & Documentation" },
      { partner: "MERCHANT", thema: "Product-Tech-Alignment" },
    ],
    pruefungsfragen: [
      "Zeichne ein C4-Container-Diagramm fuer Ghost Protocol.",
      "Erklaere SOLID-Prinzipien mit je einem Beispiel.",
      "Wann waere CQRS/Event Sourcing fuer uns sinnvoll?",
      "Wie wuerdest du Zero Trust fuer unsere Infrastruktur umsetzen?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["SOLID verstehen", "REST API Design", "Git Workflow"] },
      { stufe: "Senior", kriterien: ["DDD Bounded Contexts", "C4 Diagramme", "ADRs schreiben"] },
      { stufe: "Expert", kriterien: ["Microservices orchestrieren", "CQRS/ES", "Zero Trust Architecture"] },
    ],
  },
  {
    agentId: "treasurer",
    agentName: "TREASURER",
    role: "Chief Financial Officer",
    tier: 1,
    tierColor: "#8b5cf6",
    kernkompetenzen: [
      "DCF-Analyse — Discounted Cash Flow, WACC",
      "Unit Economics — CAC, LTV, LTV:CAC Ratio, Payback Period",
      "SaaS-Metriken — MRR, NRR, Churn, Quick Ratio",
      "Zero-Based Budgeting — Jede Ausgabe von Null begruenden",
      "Rule of 40 — Growth% + Margin% >= 40%",
      "DACH-Steuerrecht — USt, Kleinunternehmerregelung, GoBD",
    ],
    pflichtlektuere: [
      { titel: "Financial Intelligence", autor: "Berman & Knight", jahr: 2013, relevanz: "Finanz-Grundlagen" },
      { titel: "Venture Deals", autor: "Brad Feld", jahr: 2019, relevanz: "Startup-Finanzierung" },
      { titel: "The Intelligent Investor", autor: "Benjamin Graham", jahr: 1949, relevanz: "Value Investing" },
      { titel: "SaaS Metrics 2.0", autor: "David Skok (Blog)", jahr: 2023, relevanz: "SaaS-KPIs" },
    ],
    crossTraining: [
      { partner: "OPERATOR", thema: "FinOps & Cloud Cost Optimization" },
      { partner: "MERCHANT", thema: "Pricing-Strategie & Revenue Modelling" },
      { partner: "COUNSEL", thema: "Steuerrecht & Compliance" },
    ],
    pruefungsfragen: [
      "Berechne den Break-Even-Point bei €19/Monat Pricing und €55/Monat Fixkosten.",
      "Was ist der Unterschied zwischen MRR Churn und Logo Churn?",
      "Wann lohnt sich die Kleinunternehmerregelung (§19 UStG)?",
      "Erstelle eine P&L-Prognose fuer Q2 2026 mit 3 Szenarien.",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["P&L lesen", "Unit Economics berechnen", "Budget-Tracking"] },
      { stufe: "Senior", kriterien: ["DCF-Modelle", "SaaS-Metriken Dashboard", "Zero-Based Budgets"] },
      { stufe: "Expert", kriterien: ["M&A Financial Due Diligence", "Fundraising Modelling", "Tax Optimization DACH"] },
    ],
  },
  {
    agentId: "publisher",
    agentName: "PUBLISHER",
    role: "Chief Marketing Officer",
    tier: 1,
    tierColor: "#8b5cf6",
    kernkompetenzen: [
      "Positioning (Ries & Trout) — Kategorie-Fuehrerschaft",
      "StoryBrand (Donald Miller) — Kunde als Held, Brand als Guide",
      "Cialdini's 6 Principles of Persuasion",
      "Content-Marketing-Funnel — TOFU, MOFU, BOFU",
      "Eugene Schwartz 5 Awareness Levels",
      "Category Design (Play Bigger) — Neue Kategorien erschaffen",
    ],
    pflichtlektuere: [
      { titel: "Positioning", autor: "Al Ries & Jack Trout", jahr: 1981, relevanz: "Marktpositionierung" },
      { titel: "Building a StoryBrand", autor: "Donald Miller", jahr: 2017, relevanz: "Brand Messaging" },
      { titel: "Influence", autor: "Robert Cialdini", jahr: 1984, relevanz: "Persuasion" },
      { titel: "Breakthrough Advertising", autor: "Eugene Schwartz", jahr: 1966, relevanz: "Copywriting-Meisterwerk" },
      { titel: "Play Bigger", autor: "Al Ramadan et al.", jahr: 2016, relevanz: "Category Design" },
    ],
    crossTraining: [
      { partner: "SCRIBE", thema: "Content-Qualitaet & Brand Voice" },
      { partner: "AMPLIFIER", thema: "Distribution & Plattform-Algorithmen" },
      { partner: "MERCHANT", thema: "Product Marketing & Launch Strategy" },
    ],
    pruefungsfragen: [
      "Erstelle ein StoryBrand BrandScript fuer Ghost Protocol.",
      "Welche Cialdini-Prinzipien eignen sich fuer SaaS-Pricing-Pages?",
      "Definiere 5 Content Pillars fuer unsere Brand Authority.",
      "Wie unterscheiden sich die 5 Awareness Levels nach Schwartz?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["AIDA verstehen", "Content-Kalender erstellen", "Social Media Basics"] },
      { stufe: "Senior", kriterien: ["StoryBrand BrandScript", "Multi-Channel-Strategie", "CRO Basics"] },
      { stufe: "Expert", kriterien: ["Category Design", "Brand Architecture", "Global GTM Strategy"] },
    ],
  },
  {
    agentId: "counsel",
    agentName: "COUNSEL",
    role: "Chief Legal Officer",
    tier: 1,
    tierColor: "#8b5cf6",
    kernkompetenzen: [
      "DSGVO Art. 5-83 — Datenschutz-Grundverordnung",
      "EU AI Act (2024/1689) — 4 Risikoklassen, Transparenzpflichten",
      "TMG/DDG — Telemedienrecht, Impressumspflicht",
      "UrhG — Urheberrecht, KI-generierter Content",
      "AGB-Recht (§§305-310 BGB) — Vertragsgestaltung",
      "UWG — Wettbewerbsrecht, Irreführungsverbot",
    ],
    pflichtlektuere: [
      { titel: "DSGVO Kommentar", autor: "Simitis/Hornung/Spiecker", jahr: 2019, relevanz: "DSGVO-Auslegung" },
      { titel: "EU AI Act Full Text", autor: "EU Commission", jahr: 2024, relevanz: "KI-Regulierung" },
      { titel: "IT-Recht", autor: "Hoeren/Sieber/Holznagel", jahr: 2023, relevanz: "Digitales Recht DACH" },
    ],
    crossTraining: [
      { partner: "LOCALIZER", thema: "DACH-spezifische Regulierungen" },
      { partner: "TREASURER", thema: "Steuerrecht & Vertragsgestaltung" },
      { partner: "GUARDIAN", thema: "Datenschutz-Technik & TOMs" },
    ],
    pruefungsfragen: [
      "Welche Rechtsgrundlage nach Art. 6 DSGVO nutzen wir fuer Website-Analytics?",
      "In welche Risikoklasse faellt Ghost Protocol nach dem EU AI Act?",
      "Erstelle eine Checkliste fuer DSGVO-konforme Newsletter-Anmeldung.",
      "Was muss unser Impressum gemaess §5 TMG/DDG enthalten?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["DSGVO-Grundlagen", "Impressum erstellen", "Cookie-Consent"] },
      { stufe: "Senior", kriterien: ["AGB entwerfen", "DSFA durchfuehren", "EU AI Act Compliance"] },
      { stufe: "Expert", kriterien: ["Internationale Datenübermittlung", "KI-Haftung", "M&A Legal DD"] },
    ],
  },
  {
    agentId: "amplifier",
    agentName: "AMPLIFIER",
    role: "Growth & Distribution Director",
    tier: 2,
    tierColor: "#22d3ee",
    kernkompetenzen: [
      "AARRR Pirate Metrics (Dave McClure)",
      "Growth Loops (Reforge/Brian Balfour)",
      "E-E-A-T (Google) & Core Web Vitals",
      "Plattform-Algorithmen (Twitter, YouTube, LinkedIn, TikTok)",
      "Viral Coefficient (K-Factor) & Network Effects",
      "A/B-Testing mit statistischer Signifikanz",
    ],
    pflichtlektuere: [
      { titel: "Hacking Growth", autor: "Sean Ellis", jahr: 2017, relevanz: "Growth Methodology" },
      { titel: "Lean Analytics", autor: "Alistair Croll", jahr: 2013, relevanz: "Startup-Metriken" },
      { titel: "Traction", autor: "Weinberg & Mares", jahr: 2015, relevanz: "19 Traction Channels" },
    ],
    crossTraining: [
      { partner: "PUBLISHER", thema: "Content-Strategie & Brand" },
      { partner: "MERCHANT", thema: "Conversion-Optimierung" },
      { partner: "SCRIBE", thema: "Platform-Native Content" },
    ],
    pruefungsfragen: [
      "Berechne den Viral Coefficient fuer ein Referral-Programm mit K=0.8.",
      "Erklaere den Unterschied zwischen Growth Funnels und Growth Loops.",
      "Welche 3 SEO-Massnahmen haetten den hoechsten Impact fuer Ghost Protocol?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["AARRR verstehen", "UTM-Tracking", "Social Media Basics"] },
      { stufe: "Senior", kriterien: ["Growth Loops designen", "SEO-Strategie", "A/B-Testing"] },
      { stufe: "Expert", kriterien: ["Product-Led Growth", "Viral Mechanics", "Multi-Channel Attribution"] },
    ],
  },
  {
    agentId: "merchant",
    agentName: "MERCHANT",
    role: "Product & Revenue Director",
    tier: 2,
    tierColor: "#22d3ee",
    kernkompetenzen: [
      "Lean Product (Marty Cagan, 'Inspired')",
      "Jobs-to-be-Done (Christensen/Ulwick)",
      "Value-Based Pricing (Patrick Campbell)",
      "Product-Market Fit (Sean Ellis 40% Test)",
      "Kano-Modell — Must-Have, Performance, Delight",
      "NRR & MRR Waterfall — Revenue Health",
    ],
    pflichtlektuere: [
      { titel: "Inspired", autor: "Marty Cagan", jahr: 2018, relevanz: "Product Management" },
      { titel: "Continuous Discovery Habits", autor: "Teresa Torres", jahr: 2021, relevanz: "Discovery" },
      { titel: "Product-Led Growth", autor: "Wes Bush", jahr: 2019, relevanz: "PLG-Strategie" },
      { titel: "Monetizing Innovation", autor: "Ramanujam & Tacke", jahr: 2016, relevanz: "Pricing" },
    ],
    crossTraining: [
      { partner: "ARCHITECT", thema: "Tech-Feasibility & Roadmap" },
      { partner: "AMPLIFIER", thema: "Go-to-Market & Distribution" },
      { partner: "CONCIERGE", thema: "Customer Feedback & NPS" },
    ],
    pruefungsfragen: [
      "Formuliere 3 JTBD-Statements fuer einen AI Content Repurposer.",
      "Design eine 3-Tier Pricing-Seite mit Value-Based Pricing.",
      "Wie misst du Product-Market Fit quantitativ?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["User Stories schreiben", "Feature-Priorisierung", "Funnel-Basics"] },
      { stufe: "Senior", kriterien: ["JTBD-Interviews", "Pricing-Experimente", "NRR optimieren"] },
      { stufe: "Expert", kriterien: ["Platform Strategy", "Multi-Product Portfolio", "Enterprise Sales"] },
    ],
  },
  {
    agentId: "researcher",
    agentName: "RESEARCHER",
    role: "Research & Innovation Director",
    tier: 2,
    tierColor: "#22d3ee",
    kernkompetenzen: [
      "MECE-Prinzip (McKinsey) — Lueckenlose Analyse",
      "Technology Readiness Level (TRL, NASA)",
      "Three Horizons Model (McKinsey)",
      "Zettelkasten (Niklas Luhmann) — Wissensvernetzung",
      "Feynman-Technik — Komplexes einfach erklaeren",
      "Scenario Planning — Zukunftsszenarien durchdenken",
    ],
    pflichtlektuere: [
      { titel: "The Innovator's Dilemma", autor: "Clayton Christensen", jahr: 1997, relevanz: "Disruption" },
      { titel: "How to Read a Paper", autor: "S. Keshav", jahr: 2007, relevanz: "Research-Methodik" },
      { titel: "Range", autor: "David Epstein", jahr: 2019, relevanz: "Interdisziplinaeres Denken" },
    ],
    crossTraining: [
      { partner: "ORACLE", thema: "Market Intelligence" },
      { partner: "ARCHITECT", thema: "Technology Evaluation" },
      { partner: "TRADER", thema: "Quantitative Methoden" },
    ],
    pruefungsfragen: [
      "Erstelle eine MECE-Zerlegung des AI-SaaS-Marktes.",
      "Bewerte eine neue Technologie mit dem TRL-Framework.",
      "Formuliere 3 Hypothesen zum Nutzungsverhalten von Content Creators.",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["Quellenrecherche", "MECE-Analysen", "Executive Summaries"] },
      { stufe: "Senior", kriterien: ["Tech Radar fuehren", "Competitor Deep Dives", "Scenario Planning"] },
      { stufe: "Expert", kriterien: ["Innovation Portfolio Management", "Academic Paper Analysis", "Trend Forecasting"] },
    ],
  },
  {
    agentId: "guardian",
    agentName: "GUARDIAN",
    role: "Site Reliability Engineer",
    tier: 3,
    tierColor: "#10b981",
    kernkompetenzen: [
      "Google SRE Book — SLI/SLO/SLA, Error Budgets, Toil Reduction",
      "Observability (Charity Majors) — Logs, Metrics, Traces",
      "Golden Signals — Latency, Traffic, Errors, Saturation",
      "Blameless Post-Mortems — Incident-Analyse ohne Schuldzuweisung",
      "NIST Cybersecurity Framework — Identify, Protect, Detect, Respond, Recover",
      "3-2-1 Backup-Regel — RPO/RTO Management",
    ],
    pflichtlektuere: [
      { titel: "Site Reliability Engineering", autor: "Beyer, Jones et al.", jahr: 2016, relevanz: "SRE-Bibel" },
      { titel: "Observability Engineering", autor: "Charity Majors et al.", jahr: 2022, relevanz: "Observability" },
      { titel: "The Phoenix Project", autor: "Kim, Behr, Spafford", jahr: 2013, relevanz: "DevOps-Roman" },
    ],
    crossTraining: [
      { partner: "ARCHITECT", thema: "Infrastructure Design" },
      { partner: "DONNA", thema: "Incident Command & Eskalation" },
      { partner: "COUNSEL", thema: "Datenschutz-Technik (TOMs)" },
    ],
    pruefungsfragen: [
      "Definiere SLIs und SLOs fuer die Ghost Protocol API.",
      "Wie berechnest du das Error Budget bei 99.9% SLO?",
      "Erstelle ein Post-Mortem-Template fuer einen API-Ausfall.",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["Monitoring einrichten", "Alerts konfigurieren", "Backup-Routinen"] },
      { stufe: "Senior", kriterien: ["SLO-Definitionen", "Incident Management", "Capacity Planning"] },
      { stufe: "Expert", kriterien: ["Chaos Engineering", "Error Budget Policies", "Multi-Region DR"] },
    ],
  },
  {
    agentId: "scribe",
    agentName: "SCRIBE",
    role: "Content Producer",
    tier: 3,
    tierColor: "#10b981",
    kernkompetenzen: [
      "AIDA, PAS, BAB — Copywriting-Frameworks",
      "Hero's Journey (Joseph Campbell) — Storytelling",
      "StoryBrand (Donald Miller) — Narrative Structure",
      "SEO-Content — Search Intent, Featured Snippets",
      "Platform-Native Formate — Threads, Scripts, Carousels",
      "Hemingway-Prinzip — Kurz, aktiv, klar",
    ],
    pflichtlektuere: [
      { titel: "On Writing Well", autor: "William Zinsser", jahr: 1976, relevanz: "Schreibhandwerk" },
      { titel: "Everybody Writes", autor: "Ann Handley", jahr: 2014, relevanz: "Content Marketing" },
      { titel: "The Copywriter's Handbook", autor: "Robert Bly", jahr: 2020, relevanz: "Copywriting" },
    ],
    crossTraining: [
      { partner: "PUBLISHER", thema: "Brand Voice & Editorial Calendar" },
      { partner: "AMPLIFIER", thema: "SEO & Platform-Optimierung" },
      { partner: "LOCALIZER", thema: "DACH-Lokalisierung" },
    ],
    pruefungsfragen: [
      "Schreibe einen Twitter Thread Hook mit PAS-Framework.",
      "Erklaere die 5 Awareness Levels und welcher Content zu jedem passt.",
      "Erstelle eine Landing Page Outline mit Feature-Benefit-Feeling.",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["Blog-Posts schreiben", "Headlines mit 4U's", "Grammatik-Check"] },
      { stufe: "Senior", kriterien: ["Multi-Format Content", "Storytelling", "SEO-Optimierung"] },
      { stufe: "Expert", kriterien: ["Brand Voice Development", "Video Scripts", "Conversion Copy"] },
    ],
  },
  {
    agentId: "trader",
    agentName: "TRADER",
    role: "Marktanalyst",
    tier: 3,
    tierColor: "#10b981",
    kernkompetenzen: [
      "Elliott Wave Theory — 5+3 Wellenmuster",
      "Fibonacci-Levels — Retracements & Extensions",
      "Risk-Metriken — Sharpe, Sortino, Calmar, MaxDD",
      "Kelly Criterion — Optimale Positionsgroesse",
      "On-Chain — MVRV, SOPR, Exchange Flows",
      "Makro — DXY, VIX, Fed Funds, M2",
    ],
    pflichtlektuere: [
      { titel: "Technical Analysis of Financial Markets", autor: "John Murphy", jahr: 1999, relevanz: "TA-Bibel" },
      { titel: "Market Wizards", autor: "Jack Schwager", jahr: 1989, relevanz: "Trading-Psychologie" },
      { titel: "Quantitative Trading", autor: "Ernest Chan", jahr: 2008, relevanz: "Quant Methoden" },
    ],
    crossTraining: [
      { partner: "ORACLE", thema: "Marktintelligenz-Interpretation" },
      { partner: "RESEARCHER", thema: "Quantitative Forschungsmethoden" },
      { partner: "TREASURER", thema: "Risk-Adjusted Returns" },
    ],
    pruefungsfragen: [
      "Berechne den Profit Factor aus 10 Beispiel-Trades.",
      "Wann ist ein Sharpe Ratio von 1.5 'gut'?",
      "Erklaere Funding Rate Divergence als Signal.",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["Chart-Patterns erkennen", "RSI/MACD lesen", "Risiko-Basics"] },
      { stufe: "Senior", kriterien: ["Elliott Wave zaehlen", "Position Sizing (Kelly)", "On-Chain Analyse"] },
      { stufe: "Expert", kriterien: ["Quantitative Strategien", "Walk-Forward Validierung", "Regime Detection"] },
    ],
  },
  {
    agentId: "concierge",
    agentName: "CONCIERGE",
    role: "Community & Customer Success",
    tier: 3,
    tierColor: "#10b981",
    kernkompetenzen: [
      "Customer Success (Lincoln Murphy) — Proaktiver Kundenerfolg",
      "SPACES Model (CMX) — 6 Community-Wertquellen",
      "NPS/CSAT/CES — Kundenzufriedenheits-Metriken",
      "HEARD Framework (Disney) — Hear, Empathize, Apologize, Resolve, Diagnose",
      "Customer Health Score — Churn-Vorhersage",
      "Service Recovery Paradox — Probleme als Loyalitaets-Chance",
    ],
    pflichtlektuere: [
      { titel: "Customer Success", autor: "Mehta, Steinman, Murphy", jahr: 2016, relevanz: "CS-Framework" },
      { titel: "The Business of Belonging", autor: "David Spinks", jahr: 2021, relevanz: "Community" },
      { titel: "The Effortless Experience", autor: "Dixon et al.", jahr: 2013, relevanz: "CES-Forschung" },
    ],
    crossTraining: [
      { partner: "MERCHANT", thema: "Product Feedback Loop" },
      { partner: "AMPLIFIER", thema: "Community-Led Growth" },
      { partner: "SCRIBE", thema: "FAQ & Help Documentation" },
    ],
    pruefungsfragen: [
      "Design einen Customer Health Score mit 5 Faktoren.",
      "Wie reagierst du auf einen veraerrten Kunden nach dem HEARD-Framework?",
      "Erstelle eine Eskalationsmatrix fuer Support-Tickets.",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["FAQ schreiben", "Tickets beantworten", "NPS verstehen"] },
      { stufe: "Senior", kriterien: ["Health Scores designen", "Community aufbauen", "Churn Prevention"] },
      { stufe: "Expert", kriterien: ["Customer-Led Growth", "Enterprise CS", "Community Strategy"] },
    ],
  },
  {
    agentId: "localizer",
    agentName: "LOCALIZER",
    role: "Cultural Intelligence",
    tier: 3,
    tierColor: "#10b981",
    kernkompetenzen: [
      "GILT-Framework — Globalization, I18n, L10n, Translation",
      "Hofstede Cultural Dimensions — Unsicherheitsvermeidung, Individualismus",
      "DACH-Marktintelligenz — DE 84M, AT 9M, CH 8.8M",
      "Transcreation — Botschaft uebertragen, nicht nur uebersetzen",
      "hreflang SEO — DACH-spezifische Suchmaschinenoptimierung",
      "Du/Sie-Konventionen — B2C vs. B2B Tonalitaet",
    ],
    pflichtlektuere: [
      { titel: "Cultures and Organizations", autor: "Geert Hofstede", jahr: 2010, relevanz: "Kulturelle Dimensionen" },
      { titel: "Don't Make Me Think", autor: "Steve Krug", jahr: 2014, relevanz: "UX-Lokalisierung" },
    ],
    crossTraining: [
      { partner: "COUNSEL", thema: "DACH-Regulierungen" },
      { partner: "SCRIBE", thema: "Content-Lokalisierung" },
      { partner: "AMPLIFIER", thema: "Regionale Distribution" },
    ],
    pruefungsfragen: [
      "Nenne 5 sprachliche Unterschiede zwischen DE, AT und CH.",
      "Wann verwenden wir 'Du' und wann 'Sie' in Marketing-Texten?",
      "Wie setzt man hreflang-Tags fuer DACH korrekt um?",
    ],
    lernpfad: [
      { stufe: "Junior", kriterien: ["Grundlegende Lokalisierung", "Datumsformate", "Waehrungen"] },
      { stufe: "Senior", kriterien: ["Transcreation", "Kulturelle Anpassung", "SEO-Lokalisierung"] },
      { stufe: "Expert", kriterien: ["Multi-Market GTM", "Regulatorische Compliance", "International Expansion"] },
    ],
  },
];

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "Brain", color: "#f43f5e" },
  1: { label: "C-Suite", color: "#8b5cf6" },
  2: { label: "Directors", color: "#22d3ee" },
  3: { label: "Operators", color: "#10b981" },
};

export default function AcademyPage() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "lektuere" | "crosstraining" | "pruefung" | "lernpfad">("overview");

  const selected = TRAINING_DATA.find((t) => t.agentId === selectedAgent);

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
          Ghost Protocol Academy
        </h1>
        <p className="text-text-muted text-sm mt-1">
          Internes Weiterbildungsmodul — 16 Agents, 48+ Pflichtlektueren, 64+ Pruefungsfragen
        </p>
        <div className="mt-3 flex gap-4 text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-accent-violet/10 text-accent-violet">
            Erstellt: DONNA (Chief of Staff)
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-surface-elevated text-text-secondary">
            Q2 2026 Curriculum
          </div>
        </div>
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        {TRAINING_DATA.map((module) => {
          const isActive = selectedAgent === module.agentId;
          return (
            <button
              key={module.agentId}
              onClick={() => {
                setSelectedAgent(isActive ? null : module.agentId);
                setActiveTab("overview");
              }}
              className={`text-left p-4 rounded-xl border transition-all ${
                isActive
                  ? "border-accent-violet bg-accent-violet/10"
                  : "border-border bg-surface hover:bg-surface-elevated hover:border-border"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: module.tierColor }}
                />
                <span className="text-[10px] uppercase tracking-widest text-text-muted">
                  Tier {module.tier}
                </span>
              </div>
              <p className="text-sm font-semibold font-[family-name:var(--font-outfit)]">
                {module.agentName}
              </p>
              <p className="text-xs text-text-muted mt-0.5">{module.role}</p>
              <div className="mt-2 flex gap-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                  {module.pflichtlektuere.length} Buecher
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                  {module.pruefungsfragen.length} Fragen
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="card-ghost rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-4 h-4 rounded-full"
              style={{ background: selected.tierColor }}
            />
            <h2 className="text-xl font-bold font-[family-name:var(--font-outfit)]">
              {selected.agentName}
            </h2>
            <span className="text-sm text-text-muted">— {selected.role}</span>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-border pb-3">
            {[
              { id: "overview" as const, label: "Kernkompetenzen" },
              { id: "lektuere" as const, label: "Pflichtlektuere" },
              { id: "crosstraining" as const, label: "Cross-Training" },
              { id: "pruefung" as const, label: "Pruefungsfragen" },
              { id: "lernpfad" as const, label: "Lernpfad" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-accent-violet/10 text-accent-violet"
                    : "text-text-secondary hover:text-foreground hover:bg-surface-elevated"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === "overview" && (
            <div className="space-y-3">
              {selected.kernkompetenzen.map((k, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-lg bg-accent-violet/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs text-accent-violet font-bold">{i + 1}</span>
                  </div>
                  <p className="text-sm text-text-secondary">{k}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === "lektuere" && (
            <div className="space-y-3">
              {selected.pflichtlektuere.map((b, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-surface-elevated">
                  <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">&#128214;</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{b.titel}</p>
                    <p className="text-xs text-text-muted">{b.autor}, {b.jahr}</p>
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded bg-accent-violet/10 text-accent-violet flex-shrink-0">
                    {b.relevanz}
                  </span>
                </div>
              ))}
            </div>
          )}

          {activeTab === "crosstraining" && (
            <div className="space-y-3">
              {selected.crossTraining.map((ct, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-surface-elevated">
                  <div className="w-10 h-10 rounded-lg bg-accent-emerald/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-accent-emerald">{ct.partner.slice(0, 2)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{ct.partner}</p>
                    <p className="text-xs text-text-muted">{ct.thema}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "pruefung" && (
            <div className="space-y-3">
              {selected.pruefungsfragen.map((f, i) => (
                <div key={i} className="p-3 rounded-lg bg-surface-elevated">
                  <div className="flex gap-3 items-start">
                    <span className="text-xs font-bold text-accent-rose bg-accent-rose/10 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <p className="text-sm text-text-secondary">{f}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "lernpfad" && (
            <div className="space-y-4">
              {selected.lernpfad.map((lp, i) => (
                <div key={i} className="p-4 rounded-lg bg-surface-elevated">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-3 h-3 rounded-full ${
                      i === 0 ? "bg-accent-emerald" : i === 1 ? "bg-accent-cyan" : "bg-accent-violet"
                    }`} />
                    <h3 className="text-sm font-bold font-[family-name:var(--font-outfit)] uppercase tracking-wider">
                      {lp.stufe}
                    </h3>
                  </div>
                  <ul className="space-y-1.5">
                    {lp.kriterien.map((k, j) => (
                      <li key={j} className="text-sm text-text-secondary flex items-center gap-2">
                        <span className="text-text-muted">&#9744;</span>
                        {k}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quartals-Zertifizierungsplan */}
      {!selected && (
        <div className="card-ghost rounded-xl border border-border p-6">
          <h2 className="text-lg font-bold font-[family-name:var(--font-outfit)] mb-4">
            Q2 2026 Zertifizierungsplan
          </h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { woche: "KW 1-2", thema: "Kernkompetenzen", beschreibung: "Pflichtlektuere durcharbeiten, Kernframeworks verinnerlichen" },
              { woche: "KW 3-4", thema: "Cross-Training", beschreibung: "Gemeinsame Sessions mit Cross-Training-Partnern" },
              { woche: "KW 5-6", thema: "Pruefungsvorbereitung", beschreibung: "Pruefungsfragen beantworten, Schwachstellen identifizieren" },
              { woche: "KW 7-8", thema: "Zertifizierung", beschreibung: "Praktische Demonstration der Kernkompetenzen im Live-Betrieb" },
            ].map((phase, i) => (
              <div key={i} className="p-4 rounded-lg bg-surface-elevated">
                <span className="text-[10px] px-2 py-1 rounded bg-accent-violet/10 text-accent-violet uppercase tracking-wider font-bold">
                  {phase.woche}
                </span>
                <h3 className="text-sm font-bold mt-3 mb-1">{phase.thema}</h3>
                <p className="text-xs text-text-muted">{phase.beschreibung}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-accent-violet/5 border border-accent-violet/20 text-center">
              <p className="text-2xl font-bold text-accent-violet">48+</p>
              <p className="text-xs text-text-muted mt-1">Pflichtlektueren</p>
            </div>
            <div className="p-4 rounded-lg bg-accent-cyan/5 border border-accent-cyan/20 text-center">
              <p className="text-2xl font-bold text-accent-cyan">64+</p>
              <p className="text-xs text-text-muted mt-1">Pruefungsfragen</p>
            </div>
            <div className="p-4 rounded-lg bg-accent-emerald/5 border border-accent-emerald/20 text-center">
              <p className="text-2xl font-bold text-accent-emerald">48</p>
              <p className="text-xs text-text-muted mt-1">Cross-Training Sessions</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
