import React from 'react';
import { LegalPage } from './legal';

const SECTION_KEYS = [
  'privacy.s1',
  'privacy.s2',
  'privacy.s3',
  'privacy.s4',
  'privacy.s5',
  'privacy.s6',
  'privacy.s7',
  'privacy.s8',
  'privacy.s9',
  'privacy.s10',
];

export default function PrivacyPage() {
  return <LegalPage titleKey="privacy.title" introKey="privacy.intro" sectionKeys={SECTION_KEYS} />;
}
