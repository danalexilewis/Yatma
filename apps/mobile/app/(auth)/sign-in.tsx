import { useSignIn } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { colors } from "../../src/theme/colors";

function isClerkConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

/** Sign in with Apple + email code placeholders via @clerk/expo. */
export default function SignInScreen() {
  if (!isClerkConfigured()) {
    return <SignInPlaceholder />;
  }
  return <ClerkSignIn />;
}

function SignInPlaceholder() {
  const router = useRouter();
  return (
    <View className="flex-1 justify-center bg-slate-50 px-6 dark:bg-slate-950">
      <Text className="mb-2 text-3xl font-bold text-slate-900 dark:text-slate-50">Yatma</Text>
      <Text className="mb-6 text-base text-slate-600 dark:text-slate-300">
        Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to enable Clerk sign-in.
      </Text>
      <Pressable
        onPress={() => router.replace("/(tabs)")}
        className="rounded-2xl px-4 py-3"
        style={{ backgroundColor: colors.brand }}
      >
        <Text className="text-center font-medium text-white">Continue offline</Text>
      </Pressable>
    </View>
  );
}

function ClerkSignIn() {
  const router = useRouter();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { signIn } = useSignIn();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);

  async function onApple() {
    try {
      const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace("/(tabs)");
      }
    } catch (error) {
      Alert.alert("Apple sign-in failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function onEmailStart() {
    if (!signIn) return;
    try {
      const created = await signIn.create({ identifier: email.trim() });
      if (created.error) {
        Alert.alert("Email sign-in failed", created.error.message);
        return;
      }
      const sent = await signIn.emailCode.sendCode();
      if (sent.error) {
        Alert.alert("Email sign-in failed", sent.error.message);
        return;
      }
      setPendingVerification(true);
    } catch (error) {
      Alert.alert("Email sign-in failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function onEmailVerify() {
    if (!signIn) return;
    try {
      const verified = await signIn.emailCode.verifyCode({ code: code.trim() });
      if (verified.error) {
        Alert.alert("Verification failed", verified.error.message);
        return;
      }
      const finalized = await signIn.finalize();
      if (finalized.error) {
        Alert.alert("Verification failed", finalized.error.message);
        return;
      }
      router.replace("/(tabs)");
    } catch (error) {
      Alert.alert("Verification failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  return (
    <View className="flex-1 justify-center bg-slate-50 px-6 dark:bg-slate-950">
      <Text className="mb-2 text-3xl font-bold text-slate-900 dark:text-slate-50">Yatma</Text>
      <Text className="mb-6 text-base text-slate-600 dark:text-slate-300">
        Sign in to sync across devices.
      </Text>

      <Pressable onPress={() => void onApple()} className="mb-3 rounded-2xl bg-black px-4 py-3">
        <Text className="text-center font-medium text-white">Sign in with Apple</Text>
      </Pressable>

      <Text className="mb-2 mt-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Email code
      </Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        placeholderTextColor={colors.muted}
        className="mb-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
      />
      {pendingVerification ? (
        <>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="123456"
            placeholderTextColor={colors.muted}
            className="mb-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <Pressable
            onPress={() => void onEmailVerify()}
            className="rounded-2xl px-4 py-3"
            style={{ backgroundColor: colors.brand }}
          >
            <Text className="text-center font-medium text-white">Verify code</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={() => void onEmailStart()}
          className="rounded-2xl px-4 py-3"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-center font-medium text-white">Send code</Text>
        </Pressable>
      )}
    </View>
  );
}
