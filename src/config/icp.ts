export interface ICPConfig {
    industries: string[];
    jobTitles: string[];
    locations: string[];
    maxResultsPerRun: number;
}

export const ICP: ICPConfig = {
    industries: [
        "Marketing Services",
        "Advertising Services",
        "Information Technology and Services",
        "Computer Software",
        "Management Consulting"
    ],
    jobTitles: [
        "CEO",
        "Founder",
        "Co-Founder",
        "Managing Director",
        "Chief Operating Officer",
        "Director of Operations"
    ],
    locations: [
        "United States",
        "United Kingdom",
        "Canada"
    ],

    // NOTE: If this file appears as a video file in Windows, it is because of the .ts extension. 
    // It is a text file. Open it with VS Code or Notepad to edit.
    maxResultsPerRun: 25
};
