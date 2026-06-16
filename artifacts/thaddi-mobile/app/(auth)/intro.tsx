import { Feather } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { Button, LangToggle, Reveal, Screen, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";
import { useIntro } from "@/lib/intro";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const SLIDES: { icon: FeatherName; titleKey: string; bodyKey: string }[] = [
  { icon: "target", titleKey: "intro.slide1.title", bodyKey: "intro.slide1.body" },
  { icon: "users", titleKey: "intro.slide2.title", bodyKey: "intro.slide2.body" },
  { icon: "award", titleKey: "intro.slide3.title", bodyKey: "intro.slide3.body" },
];

/**
 * One-time launch onboarding. Button-driven (no horizontal scroll) so it stays
 * fully RTL-safe; the dots row and header mirror with `dir`. Skip and the final
 * "Get Started" both mark the intro seen and hand off to sign-in.
 */
export default function IntroScreen() {
  const c = useColors();
  const { t, dir } = useI18n();
  const router = useRouter();
  const { markIntroSeen } = useIntro();
  const [index, setIndex] = useState(0);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const finish = () => {
    markIntroSeen();
    router.replace("/(auth)/sign-in" as Href);
  };

  const onNext = () => {
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <Screen>
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable
          onPress={finish}
          hitSlop={12}
          accessibilityRole="button"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 8 })}
        >
          <ThemedText muted weight="semibold" size={14}>
            {t("intro.skip")}
          </ThemedText>
        </Pressable>
        <LangToggle />
      </View>

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Reveal key={index}>
          <View style={{ alignItems: "center", gap: 24 }}>
            <View
              style={{
                width: 136,
                height: 136,
                borderRadius: 68,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.card,
                borderWidth: 1.5,
                borderColor: c.thaddiGold,
                shadowColor: c.thaddiGold,
                shadowOpacity: 0.4,
                shadowRadius: 26,
                shadowOffset: { width: 0, height: 0 },
                elevation: 8,
              }}
            >
              <Feather name={slide.icon} size={56} color={c.thaddiGold} />
            </View>
            <ThemedText gold weight="extrabold" size={26} center>
              {t(slide.titleKey)}
            </ThemedText>
            <ThemedText
              muted
              size={16}
              center
              style={{ lineHeight: 25, maxWidth: 320 }}
            >
              {t(slide.bodyKey)}
            </ThemedText>
          </View>
        </Reveal>
      </View>

      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "center",
          alignItems: "center",
          gap: 8,
          marginBottom: 24,
        }}
      >
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={{
              height: 8,
              width: i === index ? 24 : 8,
              borderRadius: 4,
              backgroundColor: i === index ? c.thaddiGold : c.border,
            }}
          />
        ))}
      </View>

      <Button label={isLast ? t("intro.start") : t("intro.next")} onPress={onNext} />
    </Screen>
  );
}
