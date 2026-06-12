import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  type KeyboardTypeOptions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, type FontWeightKey } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

/* -------------------------------------------------------------------------- */
/* Stadium backdrop                                                            */
/* -------------------------------------------------------------------------- */

export function StadiumBackground({
  children,
  style,
}: {
  children?: ReactNode;
  style?: ViewStyle;
}) {
  const c = useColors();
  return (
    <View style={[{ flex: 1, backgroundColor: c.background }, style]}>
      <LinearGradient
        colors={[c.stadiumGlowGreen, "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.55 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["transparent", c.stadiumGlowGold]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 0.4 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen wrapper (safe area + stadium bg, optional scroll)                    */
/* -------------------------------------------------------------------------- */

export function Screen({
  children,
  scroll = false,
  padded = true,
  topSafe = true,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  topSafe?: boolean;
  contentStyle?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const inner: ViewStyle = {
    flexGrow: 1,
    paddingTop: topSafe ? topInset : 0,
    paddingBottom: bottomInset,
    paddingHorizontal: padded ? 20 : 0,
    ...contentStyle,
  };

  return (
    <StadiumBackground>
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={inner}>{children}</View>
      )}
    </StadiumBackground>
  );
}

/* -------------------------------------------------------------------------- */
/* Themed text (Cairo, direction-aware)                                        */
/* -------------------------------------------------------------------------- */

type ThemedTextProps = TextProps & {
  weight?: FontWeightKey;
  size?: number;
  color?: string;
  muted?: boolean;
  center?: boolean;
  gold?: boolean;
};

export function ThemedText({
  weight = "regular",
  size = 15,
  color,
  muted = false,
  center = false,
  gold = false,
  style,
  ...rest
}: ThemedTextProps) {
  const c = useColors();
  const { dir } = useI18n();
  const resolved = gold
    ? c.thaddiGold
    : color ?? (muted ? c.mutedForeground : c.foreground);
  return (
    <Text
      style={[
        {
          fontFamily: fonts[weight],
          fontSize: size,
          color: resolved,
          writingDirection: dir,
          textAlign: center ? "center" : dir === "rtl" ? "right" : "left",
        },
        style,
      ]}
      {...rest}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  style,
  ...rest
}: ViewProps & { children: ReactNode }) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: c.radius,
          padding: 16,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  fullWidth = true,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const { dir } = useI18n();
  const isDisabled = disabled || loading;

  const bg =
    variant === "primary"
      ? c.primary
      : variant === "secondary"
        ? c.secondary
        : "transparent";
  const fg =
    variant === "primary"
      ? c.primaryForeground
      : variant === "secondary"
        ? c.secondaryForeground
        : variant === "outline"
          ? c.foreground
          : c.primary;

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (isDisabled) return;
        if (Platform.OS !== "web") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPress();
      }}
      disabled={isDisabled}
      style={({ pressed }) => ({
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: bg,
        borderColor: variant === "outline" ? c.border : "transparent",
        borderWidth: variant === "outline" ? StyleSheet.hairlineWidth : 0,
        borderRadius: c.radius,
        paddingVertical: 14,
        paddingHorizontal: 18,
        alignSelf: fullWidth ? "stretch" : "flex-start",
        opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon}
          <Text
            style={{
              fontFamily: fonts.bold,
              fontSize: 15,
              color: fg,
              writingDirection: dir,
            }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Language toggle                                                             */
/* -------------------------------------------------------------------------- */

export function LangToggle() {
  const c = useColors();
  const { lang, toggleLang } = useI18n();
  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== "web") {
          void Haptics.selectionAsync();
        }
        toggleLang();
      }}
      style={({ pressed }) => ({
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.card,
        opacity: pressed ? 0.7 : 1,
      })}
      accessibilityLabel={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: c.thaddiGold }}>
        {lang === "ar" ? "EN" : "ع"}
      </Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading / empty / error states                                              */
/* -------------------------------------------------------------------------- */

export function LoadingState() {
  const c = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}

export function EmptyState({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <View style={styles.center}>
      {icon}
      <ThemedText weight="bold" size={17} center style={{ marginTop: 12 }}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText muted center size={14} style={{ marginTop: 6 }}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel: string;
}) {
  return (
    <View style={styles.center}>
      <ThemedText weight="bold" size={16} center>
        {message}
      </ThemedText>
      {onRetry ? (
        <View style={{ marginTop: 16 }}>
          <Button label={retryLabel} onPress={onRetry} variant="outline" fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Text field (direction-aware input)                                          */
/* -------------------------------------------------------------------------- */

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  autoComplete,
  error,
  multiline,
  testID,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoComplete?: TextInputProps["autoComplete"];
  error?: string;
  multiline?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const { dir } = useI18n();
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? (
        <ThemedText size={13} muted style={{ marginBottom: 6 }}>
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        multiline={multiline}
        style={{
          backgroundColor: c.card,
          borderColor: error ? c.destructive : c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: c.radius,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontFamily: fonts.regular,
          fontSize: 15,
          color: c.foreground,
          writingDirection: dir,
          textAlign: dir === "rtl" ? "right" : "left",
          minHeight: multiline ? 44 : undefined,
        }}
      />
      {error ? (
        <ThemedText size={13} color={c.destructive} style={{ marginTop: 6 }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen header (title + subtitle + dir-aware action slots)                   */
/* -------------------------------------------------------------------------- */

export function ScreenHeader({
  title,
  subtitle,
  right,
  left,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  left?: ReactNode;
}) {
  const { dir } = useI18n();
  const row: ViewStyle = {
    flexDirection: dir === "rtl" ? "row-reverse" : "row",
    alignItems: "center",
  };
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={[row, { justifyContent: "space-between", gap: 12 }]}>
        <View style={[row, { gap: 10, flexShrink: 1 }]}>
          {left}
          <View style={{ flexShrink: 1 }}>
            <ThemedText weight="extrabold" size={24}>
              {title}
            </ThemedText>
            {subtitle ? (
              <ThemedText muted size={13} style={{ marginTop: 2 }}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>
        </View>
        {right}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar (image or initials fallback)                                         */
/* -------------------------------------------------------------------------- */

export function Avatar({
  uri,
  name,
  size = 44,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
}) {
  const c = useColors();
  const initials = (name ?? "").trim().slice(0, 1).toUpperCase() || "?";
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.muted,
        }}
        contentFit="cover"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.muted,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: size * 0.4, color: c.thaddiGold }}>
        {initials}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Team flag (image or muted placeholder)                                      */
/* -------------------------------------------------------------------------- */

export function TeamFlag({ uri, size = 28 }: { uri?: string | null; size?: number }) {
  const c = useColors();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: 6, backgroundColor: c.muted }}
        contentFit="cover"
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: 6, backgroundColor: c.muted }} />
  );
}

/* -------------------------------------------------------------------------- */
/* Pill / badge label                                                          */
/* -------------------------------------------------------------------------- */

type PillTone = "neutral" | "gold" | "green" | "live";

export function Pill({ label, tone = "neutral" }: { label: string; tone?: PillTone }) {
  const c = useColors();
  const bg =
    tone === "gold"
      ? "rgba(232,180,48,0.14)"
      : tone === "green"
        ? "rgba(39,176,112,0.16)"
        : tone === "live"
          ? "rgba(220,40,40,0.16)"
          : c.muted;
  const fg =
    tone === "gold"
      ? c.thaddiGold
      : tone === "green"
        ? c.primary
        : tone === "live"
          ? c.destructive
          : c.mutedForeground;
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: fg }}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress bar (dir-aware fill)                                               */
/* -------------------------------------------------------------------------- */

export function ProgressBar({ percent }: { percent: number }) {
  const c = useColors();
  const { dir } = useI18n();
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={{
        height: 8,
        borderRadius: 999,
        backgroundColor: c.muted,
        overflow: "hidden",
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
      }}
    >
      <View style={{ width: `${p}%`, backgroundColor: c.primary, borderRadius: 999 }} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Divider                                                                     */
/* -------------------------------------------------------------------------- */

export function Divider({ style }: { style?: ViewStyle }) {
  const c = useColors();
  return (
    <View
      style={[
        { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 12 },
        style,
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Stat cell (big number + caption)                                            */
/* -------------------------------------------------------------------------- */

export function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1, gap: 2 }}>
      <ThemedText weight="extrabold" size={20} gold center>
        {value}
      </ThemedText>
      <ThemedText muted size={12} center>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
});
