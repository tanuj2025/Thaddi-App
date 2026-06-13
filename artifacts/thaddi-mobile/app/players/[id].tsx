import { Feather } from "@expo/vector-icons";
import {
  getGetPlayerProfileQueryKey,
  getGetUserFollowersQueryKey,
  getGetUserFollowingQueryKey,
  useGetPlayerProfile,
  useGetUserFollowers,
  useGetUserFollowing,
  type FavoriteTeamRef,
  type PlayerSummary,
  type ProfileChallenge,
  type ProfilePrediction,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";

import { PlayerLink, RelationshipButtons } from "@/components/social";
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Pill,
  PressableScale,
  ProgressBar,
  Reveal,
  Screen,
  ScreenHeader,
  SectionTitle,
  Skeleton,
  StatCell,
  TeamFlag,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { ltrIsolate, useI18n } from "@/lib/i18n";

type PeopleKind = "followers" | "following";

export default function PlayerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = typeof id === "string" ? id : "";
  const { t, lang, dir, formatNum } = useI18n();
  const c = useColors();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const [people, setPeople] = useState<PeopleKind | null>(null);

  const profileQ = useGetPlayerProfile(userId, {
    query: { enabled: !!userId, queryKey: getGetPlayerProfileQueryKey(userId) },
  });
  const profile = profileQ.data;

  const teamName = (team?: FavoriteTeamRef | null) =>
    team ? (lang === "ar" ? team.nameAr : team.nameEn) : t("common.na");

  const backIcon = dir === "rtl" ? "chevron-right" : "chevron-left";
  const header = (
    <ScreenHeader
      title={profile?.displayName ?? t("nav.profile")}
      left={
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Feather name={backIcon} size={24} color={c.foreground} />
        </Pressable>
      }
    />
  );

  if (profileQ.isLoading) {
    return (
      <Screen scroll>
        {header}
        <ProfileSkeleton />
      </Screen>
    );
  }

  if (profileQ.isError || !profile) {
    return (
      <Screen>
        {header}
        <ErrorState
          message={t("player.notFound")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void profileQ.refetch()}
        />
      </Screen>
    );
  }

  const { stats, levelProgress, social, viewer } = profile;

  return (
    <Screen scroll>
      {header}

      {/* identity */}
      <Reveal>
      <Card glow="gold">
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 14 }}>
          <Avatar uri={profile.avatarUrl} name={profile.displayName} size={64} />
          <View style={{ flex: 1 }}>
            <ThemedText weight="extrabold" size={20} numberOfLines={1}>
              {profile.displayName ?? t("common.na")}
            </ThemedText>
            {profile.username ? (
              <ThemedText muted size={13}>
                @{profile.username}
              </ThemedText>
            ) : null}
            <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              <Pill
                tone="gold"
                label={lang === "ar" ? levelProgress.nameAr : levelProgress.nameEn}
              />
              {viewer.followsYou ? <Pill tone="neutral" label={t("social.followsYou")} /> : null}
            </View>
          </View>
        </View>

        {/* favourite team */}
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 10, marginTop: 14 }}>
          <TeamFlag uri={profile.favoriteTeam?.flagUrl} size={28} />
          <ThemedText size={14} weight="semibold">
            {teamName(profile.favoriteTeam)}
          </ThemedText>
        </View>

        {/* relationship / self */}
        <View style={{ marginTop: 16 }}>
          {viewer.isSelf ? (
            <View style={{ gap: 10 }}>
              <ThemedText muted size={12}>
                {t("player.isYou")}
              </ThemedText>
              <Button
                label={t("player.editProfile")}
                variant="outline"
                fullWidth={false}
                onPress={() => router.push("/(tabs)/profile")}
              />
            </View>
          ) : (
            <RelationshipButtons userId={userId} viewer={viewer} />
          )}
        </View>
      </Card>
      </Reveal>

      {/* social counts */}
      <Card style={{ marginTop: 16 }}>
        <View style={{ flexDirection: rowDir }}>
          <StatCell value={formatNum(social.friendCount)} label={t("social.friends")} />
          <Pressable style={{ flex: 1 }} onPress={() => setPeople("followers")}>
            <StatCell value={formatNum(social.followerCount)} label={t("social.followers")} />
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={() => setPeople("following")}>
            <StatCell value={formatNum(social.followingCount)} label={t("social.following")} />
          </Pressable>
        </View>
      </Card>

      {/* stats */}
      <SectionTitle title={t("gam.stats")} />
      <Card>
        <View style={{ flexDirection: rowDir }}>
          <StatCell value={formatNum(stats.totalPoints)} label={t("profile.points")} />
          <StatCell value={formatNum(stats.totalPredictions)} label={t("gam.totalPredictions")} />
          <StatCell value={`${formatNum(Math.round(stats.accuracy))}%`} label={t("gam.accuracy")} />
        </View>
        <Divider />
        <View style={{ flexDirection: rowDir }}>
          <StatCell value={formatNum(stats.exactPredictions)} label={t("gam.exactPredictions")} />
          <StatCell value={formatNum(stats.competitionsWon)} label={t("gam.competitionsWon")} />
          <StatCell
            value={formatNum(stats.competitionsJoined)}
            label={t("gam.competitionsJoined")}
          />
        </View>
        {levelProgress.nextLevel ? (
          <View style={{ marginTop: 14 }}>
            <ProgressBar percent={levelProgress.progressPercent} />
            <ThemedText muted size={11} style={{ marginTop: 6 }}>
              {t("gam.nextLevel")}:{" "}
              {lang === "ar" ? levelProgress.nextLevelNameAr : levelProgress.nextLevelNameEn}
            </ThemedText>
          </View>
        ) : null}
      </Card>

      {/* challenges */}
      <SectionTitle title={t("player.currentChallenges")} />
      <Card>
        {profile.challenges.length === 0 ? (
          <ThemedText muted size={13}>
            {t("player.noChallenges")}
          </ThemedText>
        ) : (
          <View style={{ gap: 10 }}>
            {profile.challenges.map((ch, i) => (
              <ChallengeRow key={ch.id} ch={ch} last={i === profile.challenges.length - 1} />
            ))}
          </View>
        )}
      </Card>

      {/* recent predictions */}
      <SectionTitle title={t("player.recentPredictions")} />
      <Card>
        {profile.predictionsHidden ? (
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 10 }}>
            <Feather name="eye-off" size={16} color={c.mutedForeground} />
            <ThemedText muted size={13} style={{ flex: 1 }}>
              {t("player.predictionsHidden")}
            </ThemedText>
          </View>
        ) : profile.recentPredictions.length === 0 ? (
          <ThemedText muted size={13}>
            {t("player.noPredictions")}
          </ThemedText>
        ) : (
          <View style={{ gap: 12 }}>
            {profile.recentPredictions.map((p, i) => (
              <PredictionRow
                key={`${p.matchId}-${i}`}
                p={p}
                teamName={teamName}
                last={i === profile.recentPredictions.length - 1}
              />
            ))}
          </View>
        )}
      </Card>

      {/* badges */}
      {profile.badges.length > 0 ? (
        <>
          <SectionTitle title={t("gam.badges")} />
          <Card>
            <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 8 }}>
              {profile.badges.map((b) => (
                <Pill key={b.id} tone="green" label={lang === "ar" ? b.nameAr : b.nameEn} />
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {/* achievements */}
      {profile.achievements.length > 0 ? (
        <>
          <SectionTitle title={t("gam.achievements")} />
          <Card>
            <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 8 }}>
              {profile.achievements.map((a) => (
                <Pill key={a.id} tone="gold" label={lang === "ar" ? a.nameAr : a.nameEn} />
              ))}
            </View>
          </Card>
        </>
      ) : null}

      <View style={{ height: 24 }} />

      {people ? (
        <PeopleModal userId={userId} kind={people} onClose={() => setPeople(null)} />
      ) : null}
    </Screen>
  );
}

function ChallengeRow({ ch, last }: { ch: ProfileChallenge; last: boolean }) {
  const { t, dir, formatNum } = useI18n();
  const c = useColors();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <>
      <PressableScale
        onPress={() => router.push(`/challenge/${ch.id}`)}
        style={{ flexDirection: rowDir, alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <View style={{ flex: 1 }}>
          <ThemedText weight="semibold" size={14} numberOfLines={1}>
            {ch.name}
          </ThemedText>
          <ThemedText muted size={12} style={{ marginTop: 2 }}>
            {formatNum(ch.participantCount)} {t("player.members")}
          </ThemedText>
        </View>
        <Pill
          tone={ch.role === "owner" ? "gold" : "neutral"}
          label={t(`player.role.${ch.role}`)}
        />
        <Feather
          name={dir === "rtl" ? "chevron-left" : "chevron-right"}
          size={18}
          color={c.mutedForeground}
        />
      </PressableScale>
      {last ? null : <Divider />}
    </>
  );
}

function PredictionRow({
  p,
  teamName,
  last,
}: {
  p: ProfilePrediction;
  teamName: (team?: FavoriteTeamRef | null) => string;
  last: boolean;
}) {
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const tone = p.outcome === "exact" ? "gold" : p.outcome === "winner" ? "green" : "neutral";
  const hasActual = p.actualHome != null && p.actualAway != null;
  return (
    <>
      <PressableScale onPress={() => router.push(`/match/${p.matchId}`)} style={{ gap: 8 }}>
        <View style={{ flexDirection: rowDir, alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <ThemedText size={13} weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
            {teamName(p.homeTeam)} {t("common.vs")} {teamName(p.awayTeam)}
          </ThemedText>
          <Pill tone={tone} label={t(`outcome.${p.outcome}`)} />
        </View>
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 14 }}>
          <ThemedText muted size={12}>
            {t("player.predicted")}:{" "}
            {ltrIsolate(`${formatNum(p.predictedHome)}–${formatNum(p.predictedAway)}`)}
          </ThemedText>
          {hasActual ? (
            <ThemedText muted size={12}>
              {t("player.result")}:{" "}
              {ltrIsolate(`${formatNum(p.actualHome ?? 0)}–${formatNum(p.actualAway ?? 0)}`)}
            </ThemedText>
          ) : null}
          {p.outcome !== "pending" ? (
            <ThemedText size={12} gold weight="bold">
              +{formatNum(p.pointsAwarded)} {t("player.points")}
            </ThemedText>
          ) : null}
        </View>
      </PressableScale>
      {last ? null : <Divider />}
    </>
  );
}

function PeopleModal({
  userId,
  kind,
  onClose,
}: {
  userId: string;
  kind: PeopleKind;
  onClose: () => void;
}) {
  const { t, dir, lang } = useI18n();
  const c = useColors();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const followersQ = useGetUserFollowers(userId, undefined, {
    query: { enabled: kind === "followers", queryKey: getGetUserFollowersQueryKey(userId) },
  });
  const followingQ = useGetUserFollowing(userId, undefined, {
    query: { enabled: kind === "following", queryKey: getGetUserFollowingQueryKey(userId) },
  });
  const q = kind === "followers" ? followersQ : followingQ;
  const entries = q.data?.entries ?? [];

  const goToPlayer = (uid: string) => {
    onClose();
    router.push(`/players/${uid}`);
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={kind === "followers" ? t("social.followers") : t("social.following")}
    >
      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : entries.length === 0 ? (
        <EmptyState
          title={t("social.empty")}
          icon={<Feather name="users" size={26} color={c.mutedForeground} />}
        />
      ) : (
        <View style={{ gap: 12 }}>
          {entries.map((person: PlayerSummary) => (
            <View
              key={person.userId}
              style={{ flexDirection: rowDir, alignItems: "center", gap: 12 }}
            >
              <PlayerLink userId={person.userId} style={{ flex: 1 }}>
                <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12 }}>
                  <Avatar uri={person.avatarUrl} name={person.displayName} size={40} />
                  <View style={{ flex: 1 }}>
                    <ThemedText weight="semibold" size={14} numberOfLines={1}>
                      {person.displayName ?? t("common.na")}
                    </ThemedText>
                    {person.username ? (
                      <ThemedText muted size={12}>
                        @{person.username}
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              </PlayerLink>
              {!person.viewer.isSelf ? (
                <Pressable onPress={() => goToPlayer(person.userId)} hitSlop={8}>
                  <Feather
                    name={dir === "rtl" ? "chevron-left" : "chevron-right"}
                    size={20}
                    color={c.mutedForeground}
                  />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

function ProfileSkeleton() {
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Skeleton width={64} height={64} radius={32} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
      </Card>
      <Card>
        <ListSkeleton rows={3} />
      </Card>
      <Card>
        <ListSkeleton rows={4} />
      </Card>
    </View>
  );
}
