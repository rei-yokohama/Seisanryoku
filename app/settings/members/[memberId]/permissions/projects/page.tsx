"use client";

import DataPermissionPage from "../DataPermissionPage";

export default function ProjectPermissionsPage() {
  return (
    <DataPermissionPage
      title="案件権限"
      icon="📋"
      fieldName="projectPermissions"
      explanationItems={[
        "「他メンバーのデータを閲覧」がオフの場合、自分が担当またはアサインされた案件のみ表示されます",
        "「特定メンバー」を選ぶと、選択されたメンバーの案件のみ閲覧可能になります",
        "「特定グループ」を選ぶと、グループに所属するメンバーの案件のみ閲覧可能になります",
        "オーナーは常にすべての案件を閲覧できます",
      ]}
    />
  );
}
