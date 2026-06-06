import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Layout } from "../components/layout";
import { useI18n } from "../lib/i18n";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl border-border text-center border-dashed border-2">
        <CardContent className="pt-10 pb-10 flex flex-col items-center">
          <AlertCircle className="h-16 w-16 text-destructive mb-6" />
          <h1 className="text-4xl font-bold text-foreground mb-4">404</h1>
          <p className="text-lg text-muted-foreground mb-8">
            الصفحة غير موجودة / Page not found
          </p>
          <Link href="/">
            <Button size="lg">{t('nav.home') || 'Home'}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
