"use client";

import DataPermissionPage from "../DataPermissionPage";

export default function IssuePermissionsPage() {
  return (
    <DataPermissionPage
      title="課題権限"
      icon="📝"
      fieldName="issuePermissions"
      explanationItems={[
        "「他メンバーのデータを閲覧」がオフの場合、自分が担当する課題のみ表示されます",
        "「特定メンバー」を選ぶと、選択されたメンバーの課題のみ閲覧可能になります",
        "「特定グループ」を選ぶと、グループに所属するメンバーの課題のみ閲覧可能になります",
        "オーナーは常にすべての課題を閲覧できます",
      ]}
    />
  );
}
