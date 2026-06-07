import React from 'react';
import { LegalPage } from './legal';

const SECTION_KEYS = [
  'terms.s1',
  'terms.s2',
  'terms.s3',
  'terms.s4',
  'terms.s5',
  'terms.s6',
  'terms.s7',
  'terms.s8',
  'terms.s9',
  'terms.s10',
  'terms.s11',
  'terms.s12',
];

export default function TermsPage() {
  return <LegalPage titleKey="terms.title" introKey="terms.intro" sectionKeys={SECTION_KEYS} />;
}
