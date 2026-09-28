export function commentCountDisplay(extensionCommentCount, publicAvailableCommentCount, headlineCommentCount) {
  const incomplete = publicAvailableCommentCount !== null && extensionCommentCount < publicAvailableCommentCount;
  const label = incomplete ? `${extensionCommentCount} / ${publicAvailableCommentCount} コメント` :
    `${extensionCommentCount} コメント`;
  const showInfo = headlineCommentCount !== null && publicAvailableCommentCount !== null &&
    headlineCommentCount !== publicAvailableCommentCount;
  return {
    label: `${label}${showInfo ? ' ⓘ' : ''}`,
    title: showInfo ? `公開一覧として取得できるコメントは${publicAvailableCommentCount}件です。はてな公式の集計表示は${headlineCommentCount}件です。` : ''
  };
}
