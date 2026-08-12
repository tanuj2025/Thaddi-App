import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React, {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  type KeyboardTypeOptions,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
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
import Animated, {
  Easing,
  FadeInDown,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
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
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  topSafe?: boolean;
  contentStyle?: ViewStyle;
  /** Pull-to-refresh callback. Only active when `scroll` is true. */
  onRefresh?: () => void;
  refreshing?: boolean;
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
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#e8b430"
                colors={["#e8b430"]}
              />
            ) : undefined
          }
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
  glow,
  ...rest
}: ViewProps & { children: ReactNode; glow?: "gold" | "green" }) {
  const c = useColors();
  const glowColor = glow === "green" ? c.primary : glow === "gold" ? c.thaddiGold : "#000";
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderColor: glow
            ? glow === "green"
              ? c.primary
              : c.thaddiGold
            : c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: c.radius,
          padding: 16,
          // Subtle dark depth so cards lift off the deep-navy base cleanly (no colored neon shadow)
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
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
  size = "md",
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  testID?: string;
  size?: "sm" | "md" | "lg";
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
        paddingVertical: size === "sm" ? 8 : size === "lg" ? 16 : 14,
        paddingHorizontal: size === "sm" ? 14 : size === "lg" ? 24 : 18,
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
              fontSize: size === "sm" ? 13 : size === "lg" ? 17 : 15,
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
        {lang === "ar" ? "EN" : "AR"}
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
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={styles.center}>
      {icon ? (
        <View
          style={{
            width: 66,
            height: 66,
            borderRadius: 33,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: c.muted,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
          }}
        >
          {icon}
        </View>
      ) : null}
      <ThemedText weight="bold" size={17} center style={{ marginTop: 14 }}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText muted center size={14} style={{ marginTop: 6, maxWidth: 280 }}>
          {subtitle}
        </ThemedText>
      ) : null}
      {action ? <View style={{ marginTop: 18 }}>{action}</View> : null}
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

/* -------------------------------------------------------------------------- */
/* Motion — entrance reveal + press-scale wrapper                              */
/* -------------------------------------------------------------------------- */

/**
 * Fade + rise entrance. Wrap a block to give it a subtle, consistent reveal.
 * Degrades to a plain (already-visible) view if layout animations are a no-op
 * on the host platform, so content is never stuck hidden.
 */
export function Reveal({
  children,
  delay = 0,
  distance = 14,
  style,
}: {
  children: ReactNode;
  delay?: number;
  distance?: number;
  style?: ViewStyle;
}) {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).mass(0.6).delay(delay).withInitialValues({
        transform: [{ translateY: distance }],
      })}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/** Pressable that gently scales on press for a responsive, premium feel. */
export function PressableScale({
  children,
  onPress,
  disabled = false,
  haptic = false,
  scaleTo = 0.97,
  style,
  hitSlop,
  accessibilityLabel,
  accessibilityRole,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  haptic?: boolean;
  scaleTo?: number;
  style?: ViewStyle;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
  testID?: string;
}) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[aStyle, style]}>
      <Pressable
        testID={testID}
        disabled={disabled}
        hitSlop={hitSlop}
        accessibilityRole={accessibilityRole ?? "button"}
        accessibilityLabel={accessibilityLabel}
        onPressIn={() => {
          scale.value = withTiming(scaleTo, { duration: 110 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: 140 });
        }}
        onPress={() => {
          if (disabled) return;
          if (haptic && Platform.OS !== "web") void Haptics.selectionAsync();
          onPress?.();
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton loaders (shimmering placeholders)                                  */
/* -------------------------------------------------------------------------- */

export function Skeleton({
  width,
  height,
  radius = 8,
  style,
}: {
  width?: ViewStyle["width"];
  height: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const c = useColors();
  const o = useSharedValue(0.35);
  useEffect(() => {
    o.value = withRepeat(
      withTiming(0.85, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [o]);
  const aStyle = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[
        { width: width ?? "100%", height, borderRadius: radius, backgroundColor: c.muted },
        aStyle,
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton matching the match-card silhouette. */
export function MatchCardSkeleton() {
  const c = useColors();
  const { dir } = useI18n();
  const row = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View
      style={{
        backgroundColor: c.card,
        borderColor: c.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: c.radius,
        padding: 16,
        marginBottom: 12,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton width={90} height={12} />
        <Skeleton width={56} height={12} />
      </View>
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: row, alignItems: "center", gap: 10 }}>
          <Skeleton width={34} height={34} radius={8} />
          <Skeleton width={70} height={14} />
        </View>
        <Skeleton width={40} height={22} radius={6} />
        <View style={{ flexDirection: row, alignItems: "center", gap: 10 }}>
          <Skeleton width={70} height={14} />
          <Skeleton width={34} height={34} radius={8} />
        </View>
      </View>
    </View>
  );
}

/** A vertical stack of card-row skeletons (rankings, lists, etc.). */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const c = useColors();
  const { dir } = useI18n();
  const row = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View style={{ gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          style={{
            flexDirection: row,
            alignItems: "center",
            gap: 12,
            backgroundColor: c.card,
            borderColor: c.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: c.radius,
            paddingVertical: 12,
            paddingHorizontal: 14,
          }}
        >
          <Skeleton width={26} height={16} radius={4} />
          <Skeleton width={38} height={38} radius={19} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="35%" height={11} />
          </View>
          <Skeleton width={40} height={18} radius={4} />
        </View>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Section title (consistent rhythm + optional action link)                    */
/* -------------------------------------------------------------------------- */

export function SectionTitle({
  title,
  actionLabel,
  onAction,
  first = false,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  first?: boolean;
  style?: ViewStyle;
}) {
  const { dir } = useI18n();
  return (
    <View
      style={[
        {
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: first ? 0 : 24,
          marginBottom: 12,
          gap: 12,
        },
        style,
      ]}
    >
      <ThemedText weight="bold" size={17}>
        {title}
      </ThemedText>
      {actionLabel && onAction ? (
        <ThemedText gold size={13} weight="semibold" onPress={onAction}>
          {actionLabel}
        </ThemedText>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* CountUp — animated number that eases up to its value                        */
/* -------------------------------------------------------------------------- */

export function CountUp({
  value,
  weight = "extrabold",
  size = 28,
  gold = false,
  color,
  duration = 850,
  style,
}: {
  value: number;
  weight?: FontWeightKey;
  size?: number;
  gold?: boolean;
  color?: string;
  duration?: number;
  style?: TextProps["style"];
}) {
  const { formatNum } = useI18n();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <ThemedText weight={weight} size={size} gold={gold} color={color} style={style}>
      {formatNum(display)}
    </ThemedText>
  );
}

/* -------------------------------------------------------------------------- */
/* GlowCard — gradient hairline border for hero/featured surfaces             */
/* -------------------------------------------------------------------------- */

export function GlowCard({
  children,
  tone = "gold",
  style,
  contentStyle,
}: {
  children: ReactNode;
  tone?: "gold" | "green";
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}) {
  const c = useColors();
  const borderColor = tone === "green" ? c.primary : c.thaddiGold;
  return (
    <View
      style={[
        {
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: borderColor,
          backgroundColor: c.card,
        },
        style,
      ]}
    >
      <View
        style={[
          { borderRadius: c.radius - 1, padding: 18 },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* StatHero — bold level + points header (home dashboard)                      */
/* -------------------------------------------------------------------------- */

export function StatHero({
  levelLabel,
  levelName,
  pointsLabel,
  points,
  progressPercent,
  progressLabel,
}: {
  levelLabel: string;
  levelName: string;
  pointsLabel: string;
  points: number;
  progressPercent?: number;
  progressLabel?: string;
}) {
  const { dir, formatNum } = useI18n();
  const row = dir === "rtl" ? "row-reverse" : "row";
  return (
    <GlowCard tone="gold">
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexShrink: 1 }}>
          <ThemedText muted size={12}>
            {levelLabel}
          </ThemedText>
          <ThemedText weight="extrabold" size={22} gold style={{ marginTop: 2 }} numberOfLines={1}>
            {levelName}
          </ThemedText>
        </View>
        <View style={{ alignItems: dir === "rtl" ? "flex-start" : "flex-end" }}>
          <ThemedText muted size={12}>
            {pointsLabel}
          </ThemedText>
          <CountUp value={points} size={28} weight="extrabold" />
        </View>
      </View>
      {progressPercent != null ? (
        <View style={{ marginTop: 16 }}>
          <ProgressBar percent={progressPercent} />
          <View style={{ flexDirection: row, justifyContent: "space-between", marginTop: 6 }}>
            <ThemedText muted size={11}>
              {formatNum(Math.round(progressPercent))}%
            </ThemedText>
            {progressLabel ? (
              <ThemedText muted size={11} numberOfLines={1}>
                {progressLabel}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ) : null}
    </GlowCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Podium — Top-3 leaderboard hero                                             */
/* -------------------------------------------------------------------------- */

export type PodiumEntry = {
  rank: number;
  name: string;
  avatarUrl?: string | null;
  points: number;
  isCurrentUser?: boolean;
  onPress?: () => void;
};

type PodiumPlace = 1 | 2 | 3;

function PodiumColumn({ entry, place }: { entry: PodiumEntry; place: PodiumPlace }) {
  const c = useColors();
  const { t, formatNum, dir } = useI18n();
  const medal =
    place === 1 ? c.thaddiGold : place === 2 ? c.podiumSilver : c.podiumBronze;
  const first = place === 1;
  const avatarSize = first ? 64 : 52;
  // Stair-stepped heights so the trio reads as one connected podium.
  const pedestalHeight = first ? 96 : place === 2 ? 72 : 56;

  return (
    <PressableScale
      onPress={entry.onPress}
      disabled={!entry.onPress}
      style={{ flex: 1, maxWidth: 132, alignItems: "center" }}
    >
      <View style={{ alignItems: "center", gap: 6, marginBottom: 10 }}>
        {first ? <Feather name="award" size={22} color={c.thaddiGold} /> : null}
        <View
          style={{
            borderWidth: 2.5,
            borderColor: medal,
            borderRadius: (avatarSize + 8) / 2,
            padding: 3,
            backgroundColor: c.background,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: first ? 8 : 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: first ? 4 : 2,
          }}
        >
          <Avatar uri={entry.avatarUrl} name={entry.name} size={avatarSize} />
        </View>
        <ThemedText
          weight="bold"
          size={13}
          center
          numberOfLines={1}
          style={{ maxWidth: avatarSize + 30 }}
          color={entry.isCurrentUser ? c.primary : undefined}
        >
          {entry.name}
        </ThemedText>
        <View style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row", alignItems: "baseline", gap: 3 }}>
          <ThemedText weight="extrabold" size={15} gold>
            {formatNum(entry.points)}
          </ThemedText>
          <ThemedText muted size={10}>
            {t("rankings.points")}
          </ThemedText>
        </View>
      </View>
      <View
        style={{
          width: "100%",
          height: pedestalHeight,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          backgroundColor: c.card,
          borderColor: medal,
          borderWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.16,
          shadowRadius: first ? 10 : 6,
          shadowOffset: { width: 0, height: -2 },
          elevation: first ? 4 : 2,
        }}
      >
        <LinearGradient
          colors={[medal, "transparent"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[StyleSheet.absoluteFill, { opacity: 0.18 }]}
          pointerEvents="none"
        />
        <ThemedText weight="extrabold" size={first ? 28 : 20} color={medal}>
          {formatNum(place)}
        </ThemedText>
      </View>
    </PressableScale>
  );
}

export function Podium({ entries }: { entries: PodiumEntry[] }) {
  const { dir } = useI18n();
  const byRank = [...entries].sort((a, b) => a.rank - b.rank).slice(0, 3);
  const first = byRank.find((e) => e.rank === 1) ?? byRank[0];
  const second = byRank.find((e) => e.rank === 2);
  const third = byRank.find((e) => e.rank === 3);
  if (!first) return null;

  // Canonical (LTR) order: 1st always centre with a full trio, 2nd / 3rd flank
  // it; with only two finishers the champion leads on the reading-start side.
  // The row itself mirrors for RTL via flexDirection (rowDir below), so the
  // slots stay in one direction-neutral order here.
  const slots: { entry?: PodiumEntry; place: PodiumPlace }[] = third
    ? [
        { entry: second, place: 2 },
        { entry: first, place: 1 },
        { entry: third, place: 3 },
      ]
    : [
        { entry: first, place: 1 },
        { entry: second, place: 2 },
      ];

  const visible = slots.filter(
    (s): s is { entry: PodiumEntry; place: PodiumPlace } => Boolean(s.entry),
  );

  return (
    <View
      style={{
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      {visible.map((s) => (
        <PodiumColumn key={s.place} entry={s.entry} place={s.place} />
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* BottomSheet — native-feeling sheet (blur backdrop + slide-up panel)         */
/* -------------------------------------------------------------------------- */

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const c = useColors();
  const { dir } = useI18n();
  const insets = useSafeAreaInsets();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="close">
          <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(2,4,10,0.55)" }]}
          />
        </Pressable>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Animated.View
            entering={SlideInDown.springify().damping(20).mass(0.7)}
            style={{
              backgroundColor: c.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderColor: c.border,
              borderWidth: StyleSheet.hairlineWidth,
              paddingHorizontal: 20,
              paddingTop: 10,
              paddingBottom: Math.max(insets.bottom, 16) + 12,
              maxHeight: "88%",
            }}
          >
            <View
              testID="bottom-sheet-grabber"
              style={{
                alignSelf: "center",
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: c.border,
                marginBottom: 14,
              }}
            />
            {title ? (
              <View
                testID="bottom-sheet-header"
                style={{
                  flexDirection: rowDir,
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: subtitle ? 4 : 16,
                }}
              >
                <ThemedText weight="bold" size={19} style={{ flexShrink: 1 }}>
                  {title}
                </ThemedText>
                <Pressable
                  testID="bottom-sheet-close"
                  onPress={onClose}
                  hitSlop={10}
                >
                  <Feather name="x" size={22} color={c.mutedForeground} />
                </Pressable>
              </View>
            ) : null}
            {subtitle ? (
              <ThemedText muted size={13} style={{ marginBottom: 16 }}>
                {subtitle}
              </ThemedText>
            ) : null}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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
