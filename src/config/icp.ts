/**
 * Ideal Customer Profile (ICP) Configuration for Autonome
 *
 * Autonome's ICP: US-based B2B companies (10–200 employees, $1M–$50M revenue)
 * with tool sprawl (CRM + comms + project mgmt + spreadsheets) who feel operational
 * drag and want measurable ROI from AI + automation. They buy when they need systems
 * shipped quickly (days–weeks), not drawn out for months, and value deliverables
 * that include both workflow automation and a clean front-end experience.
 */

// =============================================================================
// Types
// =============================================================================

export interface ICPConfig {
    industries: string[];
    jobTitles: string[];
    locations: string[];
    maxResultsPerRun: number;
    employeeRange: { min: number; max: number };
    revenueRange: { min: string; max: string };
    seniorities: string[];
    departments: string[];
    keywords: string[];
    technologies: string[];
    excludeIndustries: string[];
    excludeTitles: string[];
}

export interface ICPProfile {
    name: string;
    description: string;
    config: ICPConfig;
}

// =============================================================================
// ICP 1 — High-velocity SMBs (PRIMARY - Core ICP)
// =============================================================================

export const ICP1_SMB_OPS: ICPProfile = {
    name: "ICP1 — SMB Ops/RevOps (Core)",
    description: "Ops-heavy B2B SMBs that need automation fast",
    config: {
        // Geography
        locations: [
            "United States"
        ],

        // Employee size: Sweet spot 20-120, range 10-200
        employeeRange: { min: 20, max: 120 },

        // Revenue: Sweet spot $3M-$25M
        revenueRange: { min: "$3M", max: "$25M" },

        // Industries (Apollo selection - Primary)
        industries: [
            "Marketing & Advertising",
            "Marketing Services",
            "Advertising Services",
            "Professional Services",
            "Management Consulting",
            "Business Consulting",
            "Information Technology & Services",
            "Computer Software",
            "Internet",
            "Financial Services",
            "Legal Services",
            "Education Management",
            "E-Learning",
            "Health, Wellness & Fitness"
        ],

        // Contact filters - Best titles to target
        jobTitles: [
            // Persona 1: Economic buyer (fast yes/no)
            "Founder",
            "Co-Founder",
            "CEO",
            "President",
            "Managing Partner",
            "Owner",
            // Persona 2: Ops leader (best champion)
            "COO",
            "Chief Operating Officer",
            "Head of Operations",
            "Director of Operations",
            "VP Operations",
            "VP of Operations",
            "Business Operations",
            "BizOps",
            "Chief of Staff",
            // Persona 3: RevOps / Sales Ops / Marketing Ops (high pain)
            "VP RevOps",
            "VP of RevOps",
            "Director of RevOps",
            "Head of RevOps",
            "Revenue Operations Manager",
            "Revenue Operations Director",
            "Sales Operations Manager",
            "Sales Operations Director",
            "Director of Sales Operations",
            "Marketing Operations Manager",
            "Marketing Operations Director",
            "Director of Marketing Operations",
            // Persona 4: Technical owner
            "CTO",
            "Chief Technology Officer",
            "VP Engineering",
            "VP of Engineering",
            "Head of Engineering"
        ],

        // Seniority levels
        seniorities: [
            "Owner",
            "C-Suite",
            "VP",
            "Director",
            "Head"
        ],

        // Departments
        departments: [
            "Operations",
            "RevOps",
            "Sales Operations",
            "Marketing Operations",
            "Product",
            "Engineering",
            "IT",
            "Customer Success",
            "Finance"
        ],

        // Technologies (strong-fit signals)
        technologies: [
            // Automation / integration tools (highest intent)
            "Zapier",
            "Make",
            "Integromat",
            "n8n",
            // Ops + CRM
            "HubSpot",
            "Salesforce",
            "Pipedrive",
            // Work management
            "Asana",
            "ClickUp",
            "Jira",
            "Monday",
            // Data / internal ops
            "Airtable",
            "Notion",
            "Google Sheets",
            // Comms
            "Slack",
            "Microsoft Teams",
            "Google Workspace",
            "Microsoft 365",
            // Payments / finance
            "Stripe",
            "QuickBooks",
            "Xero"
        ],

        // Keywords for search / intent
        keywords: [
            "RevOps",
            "Sales Ops",
            "Marketing Ops",
            "BizOps",
            "Operations",
            "Automation",
            "workflow",
            "integrations",
            "systems",
            "process",
            "AI agent",
            "agentic",
            "AI automation"
        ],

        // Industries to exclude
        excludeIndustries: [
            "Government Administration",
            "Hospital & Health Care",
            "Higher Education",
            "Manufacturing",
            "Construction",
            "Non-profit"
        ],

        // Titles to exclude (save time)
        excludeTitles: [
            "Student",
            "Intern",
            "Recruiter",
            "HR Generalist",
            "Sales Rep",
            "Account Executive",
            "SDR",
            "BDR"
        ],

        maxResultsPerRun: 50
    }
};

// =============================================================================
// ICP 2 — Agencies & Consultancies
// =============================================================================

export const ICP2_AGENCIES: ICPProfile = {
    name: "ICP2 — Agencies/Consultancies",
    description: "Agencies & consultancies selling services (fast sales, high leverage)",
    config: {
        locations: [
            "United States",
            "Canada",
            "United Kingdom",
            "Australia"
        ],

        employeeRange: { min: 5, max: 150 },
        revenueRange: { min: "$500K", max: "$30M" },

        industries: [
            "Marketing & Advertising",
            "Management Consulting",
            "Design",
            "Web Development",
            "IT Services",
            "Systems Integrators"
        ],

        jobTitles: [
            "Agency Owner",
            "Founder",
            "Managing Partner",
            "COO",
            "Director of Operations",
            "Head of Delivery",
            "Head of Client Services",
            "Head of Growth"
        ],

        seniorities: [
            "Owner",
            "C-Suite",
            "VP",
            "Director",
            "Head"
        ],

        departments: [
            "Operations",
            "Delivery",
            "Client Services",
            "Growth"
        ],

        technologies: [
            "HubSpot",
            "Salesforce",
            "ClickUp",
            "Asana",
            "Jira",
            "Slack",
            "Airtable",
            "Notion",
            "Zapier",
            "Make",
            "n8n",
            "Webflow",
            "WordPress",
            "Shopify"
        ],

        keywords: [
            "automation",
            "AI",
            "workflow",
            "productized service",
            "white-label"
        ],

        excludeIndustries: [],

        excludeTitles: [
            "Student",
            "Intern",
            "Freelancer"
        ],

        maxResultsPerRun: 30
    }
};

// =============================================================================
// ICP 3 — B2B SaaS Platforms
// =============================================================================

export const ICP3_SAAS: ICPProfile = {
    name: "ICP3 — SaaS Platforms",
    description: "B2B/B2B2C SaaS platforms needing workflow + AI systems",
    config: {
        locations: [
            "United States"
        ],

        employeeRange: { min: 20, max: 500 },
        revenueRange: { min: "$1M", max: "$100M" },

        industries: [
            "Computer Software",
            "Internet",
            "Fintech",
            "Legal Tech",
            "EdTech",
            "Sports Tech",
            "HR Tech"
        ],

        jobTitles: [
            "Head of Product",
            "Product Ops",
            "CTO",
            "VP Engineering",
            "VP of Engineering",
            "Head of Ops",
            "Head of BizOps",
            "Head of Customer Success",
            "CS Ops",
            "RevOps Leader",
            "Director of Product"
        ],

        seniorities: [
            "C-Suite",
            "VP",
            "Director",
            "Head"
        ],

        departments: [
            "Product",
            "Engineering",
            "Operations",
            "Customer Success",
            "RevOps"
        ],

        technologies: [
            "Segment",
            "RudderStack",
            "Mixpanel",
            "Intercom",
            "Zendesk",
            "HubSpot",
            "Salesforce",
            "Stripe",
            "Slack",
            "Zapier",
            "Make",
            "n8n"
        ],

        keywords: [
            "product-led",
            "PLG",
            "onboarding",
            "lifecycle",
            "support automation",
            "internal tools"
        ],

        excludeIndustries: [],

        excludeTitles: [
            "Student",
            "Intern"
        ],

        maxResultsPerRun: 30
    }
};

// =============================================================================
// Default Export (Primary ICP)
// =============================================================================

/**
 * Primary ICP configuration for the scheduler
 * Uses ICP1 (SMB Ops) as the default
 */
export const ICP: ICPConfig = ICP1_SMB_OPS.config;

// All ICP profiles for reference
export const ALL_ICPS: ICPProfile[] = [
    ICP1_SMB_OPS,
    ICP2_AGENCIES,
    ICP3_SAAS
];

// =============================================================================
// Apollo List Configurations (for building Apollo saved searches)
// =============================================================================

export const APOLLO_LISTS = {
    // List 1: Core (Highest close rate)
    core: {
        name: "ICP1 — Core (Highest close rate)",
        accounts: {
            location: "United States",
            employeeMin: 20,
            employeeMax: 120,
            revenueMin: "$3M",
            revenueMax: "$25M",
            industries: [
                "Marketing & Advertising",
                "Professional Services",
                "Management Consulting",
                "IT Services",
                "Computer Software"
            ],
            technologies: ["Zapier", "Make", "n8n", "HubSpot"]
        },
        people: {
            seniorities: ["Owner", "C-Suite", "VP", "Director"],
            titles: ICP1_SMB_OPS.config.jobTitles.slice(0, 20) // Top 20 titles
        }
    },

    // List 2: Expanded (More volume)
    expanded: {
        name: "ICP1 — Expanded (More volume)",
        accounts: {
            location: "United States",
            employeeMin: 10,
            employeeMax: 200,
            industries: ICP1_SMB_OPS.config.industries
            // No technographic requirement
        },
        people: {
            seniorities: ["Owner", "C-Suite", "VP", "Director", "Manager"],
            titles: ICP1_SMB_OPS.config.jobTitles
        }
    },

    // List 3: Automation-Intent (Highest intent)
    automationIntent: {
        name: "ICP1 — Automation-Intent (Highest intent)",
        accounts: {
            location: "United States",
            employeeMin: 10,
            employeeMax: 200,
            technologies: ["Zapier", "Make", "n8n"] // Required
        },
        people: {
            seniorities: ["Owner", "C-Suite", "VP", "Director"],
            // Ops + RevOps personas first
            titles: [
                "COO",
                "Head of Operations",
                "Director of Operations",
                "VP Operations",
                "RevOps",
                "Sales Operations",
                "Marketing Operations"
            ]
        }
    }
};

// =============================================================================
// Messaging Angles (for email sequences)
// =============================================================================

export const POSITIONING_ANGLES = {
    founderCeo: "Cut operational drag + ship automation fast with measurable ROI.",
    cooOps: "Replace manual handoffs with reliable workflows + dashboards.",
    revOps: "Fix routing + follow-up + CRM hygiene → faster pipeline + less leakage.",
    ctoIt: "Clean integrations, fewer brittle zaps, scalable automation patterns."
};
