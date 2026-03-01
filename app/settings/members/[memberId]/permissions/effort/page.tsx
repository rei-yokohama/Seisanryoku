"use client";

import DataPermissionPage from "../DataPermissionPage";

export default function EffortPermissionsPage() {
  return (
    <DataPermissionPage
      title="工数権限"
      icon="⏱"
      fieldName="effortPermissions"
      explanationItems={[
        "「他メンバーのデータを閲覧」がオフの場合、自分の工数データのみ表示されます",
        "「特定メンバー」を選ぶと、選択されたメンバーの工数データのみ閲覧可能になります",
        "「特定グループ」を選ぶと、グループに所属するメンバーの工数データのみ閲覧可能になります",
        "サイドバーの従業員リストも閲覧可能なメンバーのみ表示されます",
        "オーナーは常にすべての工数データを閲覧できます",
      ]}
    />
  );
}
