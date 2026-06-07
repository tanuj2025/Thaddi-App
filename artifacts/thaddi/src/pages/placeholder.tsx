import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Construction } from 'lucide-react';

export default function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useI18n();
  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-4xl font-black tracking-tight text-gold-gradient pb-1">{t(titleKey)}</h1>
        <Card className="card-premium">
          <CardContent className="py-16 flex flex-col items-center text-center gap-6">
            <div className="w-20 h-20 rounded-full bg-secondary/10 flex items-center justify-center ring-1 ring-secondary/30 glow-gold">
              <Construction className="w-10 h-10 text-secondary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">{t('placeholder.title')}</h2>
              <p className="text-muted-foreground max-w-sm mx-auto">{t('placeholder.desc')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
