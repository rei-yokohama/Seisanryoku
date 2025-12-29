import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { email, password, displayName } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "メールアドレスとパスワードが必要です" },
        { status: 400 }
      );
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Firebase APIキーが設定されていません" },
        { status: 500 }
      );
    }

    // Firebase Authentication REST APIを使用してユーザーを作成
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          displayName: displayName || undefined,
          returnSecureToken: true,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Firebase Auth API error:", data);
      
      // エラーメッセージを日本語化
      let errorMessage = "ユーザーの作成に失敗しました";
      if (data.error?.message === "EMAIL_EXISTS") {
        errorMessage = "このメールアドレスは既に使用されています";
      } else if (data.error?.message === "WEAK_PASSWORD") {
        errorMessage = "パスワードが弱すぎます（6文字以上必要）";
      } else if (data.error?.message) {
        errorMessage = data.error.message;
      }

      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      uid: data.localId,
      email: data.email,
    });
  } catch (error: unknown) {
    console.error("Error creating user:", error);
    const err = error as { message?: string };
    return NextResponse.json(
      { error: err.message || "ユーザーの作成に失敗しました" },
      { status: 500 }
    );
  }
}

