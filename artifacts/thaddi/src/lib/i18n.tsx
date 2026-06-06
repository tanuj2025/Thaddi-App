import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Language = 'ar' | 'en';

type Translations = Record<string, string>;

const translations: Record<Language, Translations> = {
  ar: {
    'app.name': 'تحدي',
    'app.tagline': 'توقّع. نافس. اكسب.',
    'nav.home': 'الرئيسية',
    'nav.challenges': 'التحديات',
    'nav.rankings': 'التصنيف',
    'nav.matches': 'المباريات',
    'nav.profile': 'الملف الشخصي',
    'auth.signIn': 'تسجيل الدخول',
    'auth.signUp': 'حساب جديد',
    'auth.signOut': 'تسجيل الخروج',
    'hero.title': 'كأس العالم ٢٠٢٦ يبدأ هنا',
    'hero.subtitle': 'اصنع تحديات خاصة مع أصدقائك وعائلتك. شارك عبر الواتساب وتنافس على القمة.',
    'hero.cta': 'ابدأ التحدي الآن',
    'landing.stats.users': 'لاعب',
    'landing.stats.challenges': 'تحدي',
    'landing.stats.predictions': 'توقع',
    'pricing.title': 'باقات التحدي',
    'pricing.free.name': 'مجاني',
    'pricing.free.price': '٠ ريال',
    'pricing.free.desc': 'حتى ٢٠ مشارك في التحدي',
    'pricing.pro.name': 'المحترف',
    'pricing.pro.price': '٢٠٠ ريال',
    'pricing.pro.desc': 'حتى ١٠٠ مشارك + إحصائيات متقدمة',
    'pricing.legend.name': 'الأسطورة',
    'pricing.legend.price': '١٠٠٠ ريال',
    'pricing.legend.desc': 'حتى ٥٠٠ مشارك + دعم حصري',
    'pricing.business.name': 'الأعمال',
    'pricing.business.price': 'قريباً',
    'pricing.business.desc': 'حلول مخصصة للشركات',
    'onboarding.title': 'أكمل ملفك الشخصي',
    'onboarding.realName': 'الاسم الكامل',
    'onboarding.displayName': 'اسم العرض (يظهر للجميع)',
    'onboarding.username': 'اسم المستخدم (@)',
    'onboarding.suggest': 'اقترح اسماً',
    'onboarding.submit': 'حفظ ومتابعة',
    'verify.title': 'تفعيل رقم الجوال',
    'verify.subtitle': 'أدخل رقم جوالك السعودي (مثال: ٠٥XXXXXXXX)',
    'verify.phone': 'رقم الجوال',
    'verify.send': 'إرسال الرمز',
    'verify.code': 'رمز التحقق',
    'verify.confirm': 'تأكيد',
    'verify.resend': 'إعادة إرسال بعد',
    'verify.resend.now': 'إعادة إرسال الرمز',
    'home.welcome': 'مرحباً',
    'home.createChallenge': 'إنشاء تحدي جديد',
    'home.shareWhatsApp': 'شارك عبر واتساب',
    'home.comingSoon': 'قريباً',
    'gate.verifying': 'جاري التحقق...',
    'gate.email.title': 'تأكيد البريد الإلكتروني',
    'gate.email.desc': 'يرجى التحقق من صندوق الوارد الخاص بك لتفعيل حسابك.',
  },
  en: {
    'app.name': 'THADDI',
    'app.tagline': 'Predict. Compete. Win.',
    'nav.home': 'Home',
    'nav.challenges': 'Challenges',
    'nav.rankings': 'Rankings',
    'nav.matches': 'Matches',
    'nav.profile': 'Profile',
    'auth.signIn': 'Sign In',
    'auth.signUp': 'Sign Up',
    'auth.signOut': 'Sign Out',
    'hero.title': 'The 2026 World Cup Starts Here',
    'hero.subtitle': 'Create private prediction challenges with friends and family. Share via WhatsApp and compete for the top.',
    'hero.cta': 'Start Challenging Now',
    'landing.stats.users': 'Players',
    'landing.stats.challenges': 'Challenges',
    'landing.stats.predictions': 'Predictions',
    'pricing.title': 'Challenge Passes',
    'pricing.free.name': 'Free',
    'pricing.free.price': '0 SAR',
    'pricing.free.desc': 'Up to 20 participants',
    'pricing.pro.name': 'Professional',
    'pricing.pro.price': '200 SAR',
    'pricing.pro.desc': 'Up to 100 participants + advanced stats',
    'pricing.legend.name': 'Legend',
    'pricing.legend.price': '1000 SAR',
    'pricing.legend.desc': 'Up to 500 participants + priority support',
    'pricing.business.name': 'Business',
    'pricing.business.price': 'Coming Soon',
    'pricing.business.desc': 'Custom corporate solutions',
    'onboarding.title': 'Complete Your Profile',
    'onboarding.realName': 'Full Name',
    'onboarding.displayName': 'Display Name (Public)',
    'onboarding.username': 'Username (@)',
    'onboarding.suggest': 'Suggest Name',
    'onboarding.submit': 'Save & Continue',
    'verify.title': 'Verify Mobile Number',
    'verify.subtitle': 'Enter your Saudi mobile number (e.g. 05XXXXXXXX)',
    'verify.phone': 'Mobile Number',
    'verify.send': 'Send Code',
    'verify.code': 'Verification Code',
    'verify.confirm': 'Confirm',
    'verify.resend': 'Resend in',
    'verify.resend.now': 'Resend Code',
    'home.welcome': 'Welcome',
    'home.createChallenge': 'Create New Challenge',
    'home.shareWhatsApp': 'Share via WhatsApp',
    'home.comingSoon': 'Coming Soon',
    'gate.verifying': 'Verifying...',
    'gate.email.title': 'Verify Your Email',
    'gate.email.desc': 'Please check your inbox to verify your email address.',
  }
};

interface I18nContextType {
  lang: Language;
  dir: 'rtl' | 'ltr';
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('thaddi_lang');
    return (saved === 'ar' || saved === 'en') ? saved : 'ar';
  });

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    localStorage.setItem('thaddi_lang', lang);
  }, [lang, dir]);

  const t = (key: string): string => {
    return translations[lang][key] || key;
  };

  return (
    <I18nContext.Provider value={{ lang, dir, setLang: setLangState, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
