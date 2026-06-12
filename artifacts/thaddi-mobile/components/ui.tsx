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

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
});
