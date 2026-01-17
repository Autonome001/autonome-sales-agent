/**
 * Import leads from Apollo.io CSV export into Supabase
 *
 * Usage: npx tsx scripts/import-apollo-csv.ts
 */

import { leadsDb } from '../src/db/index.js';
import type { CreateLead } from '../src/types/index.js';

// Apollo CSV export data - parsed from the CSV file
const apolloLeads = [
  {
    firstName: "Lily",
    lastName: "Comyn",
    title: "Founder and CEO",
    companyName: "CJI Marketing & Consulting",
    email: "lily@cjimarketing.com",
    phone: "+1 972-754-6112",
    linkedinUrl: "http://www.linkedin.com/in/lily-comyn-5b7875113",
    website: "https://cjimarketing.com",
    city: "Dallas",
    state: "Texas",
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
  {
    firstName: "Grace",
    lastName: "Fenix",
    title: "Founder and CEO (of Freelance E-marketplace for AI / Research)",
    companyName: "Big Robin",
    email: "grace@bigrobin.com",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/grace-fenix-9735aba",
    website: "https://bigrobin.com",
    city: "San Diego",
    state: "California",
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
  {
    firstName: "Alberto",
    lastName: "Corbi",
    title: "Founder",
    companyName: "B2C INTEGRATED MANAGEMENT",
    email: "acorbi@eptisa.com",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/alberto-corbi-25847514",
    website: "https://b2cim.com",
    city: "Miami Beach",
    state: "Florida",
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
  {
    firstName: "Irina",
    lastName: "Balyurko",
    title: "Co-founder and Partner",
    companyName: "Red Rocks E-Commerce",
    email: "irina@redrocksecommerce.com",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/irinabalyurko",
    website: "https://redrocksecommerce.com",
    city: "Salt Lake City",
    state: "Utah",
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
  {
    firstName: "Jared",
    lastName: "Gold",
    title: "CEO/Founder",
    companyName: "Apical Consulting",
    email: "perspective@apical.info",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/jared-gold-38105350",
    website: "https://apicalconsulting.co",
    city: "Lexington",
    state: "Kentucky",
    country: "United States",
    industry: "professional training & coaching",
    seniority: "Founder",
  },
  {
    firstName: "Simon",
    lastName: "Weiss",
    title: "CEO and Founder at M.V.P Consulting Services. Shaping the Future",
    companyName: "M.V.P Consulting Services",
    email: "sweiss@makevegaspay.com",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/siweiss",
    website: "https://makevegaspay.com",
    city: "Fort Lauderdale",
    state: "Florida",
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
  {
    firstName: "Luke",
    lastName: "Flaherty",
    title: "Founder",
    companyName: "WAVE Web Consulting",
    email: "luke@waveconsulting.biz",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/luke-flaherty-767465192",
    website: "https://waveconsulting.biz",
    city: "Wilmington",
    state: "North Carolina",
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
  {
    firstName: "Lara",
    lastName: "Brooks",
    title: "Founder",
    companyName: "AceBrooks Consulting",
    email: "lara@acebrooks.com",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/lara-brooks-b858a72",
    website: "https://acebrooks.com",
    city: null,
    state: null,
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
  {
    firstName: "Sinan",
    lastName: "Dereci",
    title: "Co-Founder, Founder, Co Founder",
    companyName: "Digithales.co",
    email: "sinan@digithales.co",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/sinandereci",
    website: "https://digithales.co",
    city: null,
    state: null,
    country: "Turkey",
    industry: "marketing & advertising",
    seniority: "Founder",
  },
  {
    firstName: "Reed",
    lastName: "Thompson",
    title: "CEO and Co-Founder",
    companyName: "Goat Consulting",
    email: "reed@goatconsulting.com",
    phone: null,
    linkedinUrl: "http://www.linkedin.com/in/reedmthompson",
    website: "https://goatconsulting.com",
    city: "Minneapolis",
    state: "Minnesota",
    country: "United States",
    industry: "management consulting",
    seniority: "Founder",
  },
];

async function importLeads() {
  console.log('📥 Importing leads from Apollo CSV export...\n');

  // Transform to CreateLead format
  const leadsToCreate: CreateLead[] = apolloLeads.map(lead => ({
    first_name: lead.firstName,
    last_name: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    linkedin_url: lead.linkedinUrl,
    company_name: lead.companyName,
    job_title: lead.title,
    seniority: lead.seniority,
    industry: lead.industry,
    website_url: lead.website,
    city: lead.city,
    state: lead.state,
    country: lead.country,
    source: 'apollo-csv-import',
  }));

  console.log(`Found ${leadsToCreate.length} leads to import\n`);

  // Import using the existing createMany function (handles duplicates)
  const { created, skipped } = await leadsDb.createMany(leadsToCreate);

  console.log('\n📊 Import Summary:');
  console.log(`   ✅ Created: ${created.length} leads`);
  console.log(`   ⏭️  Skipped: ${skipped} duplicates`);

  if (created.length > 0) {
    console.log('\n📋 Imported leads:');
    for (const lead of created) {
      console.log(`   • ${lead.first_name} ${lead.last_name} - ${lead.job_title} at ${lead.company_name}`);
    }
  }

  console.log('\n✅ Import complete!');
}

// Run the import
importLeads().catch(console.error);
