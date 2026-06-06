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
        <h1 className="text-3xl font-bold tracking-tight">{t(titleKey)}</h1>
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Construction className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold">{t('placeholder.title')}</h2>
            <p className="text-muted-foreground max-w-sm">{t('placeholder.desc')}</p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
