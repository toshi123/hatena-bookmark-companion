export const BADGE_COLORS = Object.freeze({ bookmarked: '#E53935', 'not-bookmarked': '#22C55E', unknown: '#01A5DF' });

export function badgeColor(status) {
  return BADGE_COLORS[status] || BADGE_COLORS.unknown;
}

export function badgeTitle(count, status) {
  const state = status === 'bookmarked' ? 'あなたもブックマーク済み' :
    status === 'not-bookmarked' ? '未ブックマーク' : '状態未確認';
  return `Hatena Bookmark Companion\n${count === null ? '件数未確認' : `${count} bookmarks`} · ${state}`;
}
