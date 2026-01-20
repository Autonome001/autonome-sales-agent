export interface Persona {
    name: string;
    email: string;
    title: string;
}

export const PERSONAS: Persona[] = [
    {
        name: 'Brian P.',
        email: 'brian@autonome.us',
        title: 'Solutions Consultant'
    },
    {
        name: 'Crystal R.',
        email: 'crystal@autonome.us',
        title: 'Director of Client Services & Automation Strategy'
    },
    {
        name: 'Johnnie T.',
        email: 'johnnie@autonome.us',
        title: 'Account Executive'
    },
    {
        name: 'Kevin J.',
        email: 'kevin@autonome.us',
        title: 'Director of Partnerships'
    },
    {
        name: 'Jonathan R.',
        email: 'jonathan@autonome.us',
        title: 'Account Executive'
    }
];

export const GET_PERSONA_BY_EMAIL = (email: string): Persona | undefined => {
    return PERSONAS.find(p => p.email.toLowerCase() === email.toLowerCase());
};
