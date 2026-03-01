"use client";

import DataPermissionPage from "../DataPermissionPage";

export default function CustomerPermissionsPage() {
  return (
    <DataPermissionPage
      title="顧客権限"
      icon="👥"
      fieldName="customerPermissions"
      explanationItems={[
        "「他メンバーのデータを閲覧」がオフの場合、自分が担当の顧客のみ表示されます",
        "「特定メンバー」を選ぶと、選択されたメンバーの顧客のみ閲覧可能になります",
        "「特定グループ」を選ぶと、グループに所属するメンバーの顧客のみ閲覧可能になります",
        "オーナーは常にすべての顧客を閲覧できます",
      ]}
    />
  );
}
