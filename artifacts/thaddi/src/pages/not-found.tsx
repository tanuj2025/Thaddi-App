import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Layout } from "../components/layout";
import { useI18n } from "../lib/i18n";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-stadium p-4">
      <Card className="w-full max-w-md card-premium text-center border-dashed border-2 border-secondary/50 glow-gold">
        <CardContent className="pt-10 pb-10 flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-secondary/10 flex items-center justify-center mb-6">
            <AlertCircle className="h-10 w-10 text-secondary" />
          </div>
          <h1 className="text-5xl font-black text-gold-gradient mb-4">404</h1>
          <p className="text-lg text-muted-foreground mb-8">
            {t('notFound.message')}
          </p>
          <Link href="/">
            <Button size="lg" className="bg-secondary text-secondary-foreground hover:bg-secondary/90">{t('nav.home')}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
