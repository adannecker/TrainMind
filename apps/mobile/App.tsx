import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";

const API_BASE_URL = "http://10.0.2.2:8000/api";

type LoginResponse = {
  token: string;
  email: string;
};

type NutritionItem = {
  id: string;
  custom_name: string | null;
  amount_g: number;
  kcal: number | null;
};

type NutritionEntry = {
  id: string;
  consumed_at: string;
  meal_type: string | null;
  items: NutritionItem[];
};

type EntriesResponse = {
  entries: NutritionEntry[];
};

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text) as T;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("achim@trainmind.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<NutritionEntry[]>([]);

  const [itemName, setItemName] = useState("");
  const [amountG, setAmountG] = useState("300");
  const [kcal, setKcal] = useState("");

  const authHeaders = useMemo(() => {
    if (!token) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  async function login() {
    setError(null);
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const payload = await parseJsonSafe<LoginResponse | { detail?: string }>(response);
    if (!response.ok || !payload || !("token" in payload)) {
      setError(payload && "detail" in payload ? payload.detail || "Login failed" : "Login failed");
      return;
    }
    setToken(payload.token);
  }

  async function loadEntries() {
    if (!token) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/nutrition/entries`, { headers: authHeaders });
    const payload = await parseJsonSafe<EntriesResponse | { detail?: string }>(response);
    if (!response.ok || !payload || !("entries" in payload)) {
      setError(payload && "detail" in payload ? payload.detail || "Load failed" : "Load failed");
      return;
    }
    setEntries(payload.entries);
  }

  async function createEntry() {
    if (!token) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/nutrition/entries`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        consumed_at: new Date().toISOString(),
        meal_type: "snack",
        source: "manual",
        items: [
          {
            custom_name: itemName,
            amount_g: Number(amountG),
            kcal: kcal ? Number(kcal) : null,
          },
        ],
      }),
    });
    if (!response.ok) {
      const payload = await parseJsonSafe<{ detail?: string }>(response);
      setError(payload?.detail || "Create failed");
      return;
    }
    setItemName("");
    setAmountG("300");
    setKcal("");
    await loadEntries();
  }

  async function deleteEntry(entryId: string) {
    if (!token) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/nutrition/entries/${entryId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      const payload = await parseJsonSafe<{ detail?: string }>(response);
      setError(payload?.detail || "Delete failed");
      return;
    }
    await loadEntries();
  }

  useEffect(() => {
    void loadEntries();
  }, [token]);

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.card}>
          <Text style={styles.title}>TrainMind Mobile</Text>
          <Text style={styles.sub}>Login</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" />
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.primary} onPress={() => void login()}>
            <Text style={styles.primaryText}>Anmelden</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            Android Emulator: API via 10.0.2.2. Für iOS Simulator nutze normalerweise 127.0.0.1.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.title}>Ernährung erfassen</Text>
          <TextInput style={styles.input} placeholder="Was?" value={itemName} onChangeText={setItemName} />
          <TextInput style={styles.input} placeholder="Menge (g)" value={amountG} onChangeText={setAmountG} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder="kcal" value={kcal} onChangeText={setKcal} keyboardType="numeric" />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.primary} onPress={() => void createEntry()}>
            <Text style={styles.primaryText}>Speichern</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.sub}>Letzte Einträge</Text>
            <TouchableOpacity onPress={() => void loadEntries()}>
              <Text style={styles.link}>Aktualisieren</Text>
            </TouchableOpacity>
          </View>
          {entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <View style={styles.row}>
                <Text style={styles.entryTitle}>{new Date(entry.consumed_at).toLocaleString("de-CH")}</Text>
                <TouchableOpacity onPress={() => void deleteEntry(entry.id)}>
                  <Text style={styles.delete}>🗑</Text>
                </TouchableOpacity>
              </View>
              {entry.items.map((item) => (
                <Text key={item.id} style={styles.entryItem}>
                  {(item.custom_name || "Item") + ` · ${Math.round(item.amount_g)}g · ${Math.round(item.kcal || 0)} kcal`}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#eef6f2" },
  scroll: { padding: 16, gap: 12 },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 10 },
  title: { fontSize: 24, fontWeight: "700", color: "#1a3d36" },
  sub: { fontSize: 16, fontWeight: "600", color: "#315f56" },
  input: { borderWidth: 1, borderColor: "#d2e3dd", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#fff" },
  primary: { backgroundColor: "#1f8b6f", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700" },
  error: { color: "#a53535" },
  hint: { color: "#4f6863", fontSize: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: "#1f8b6f", fontWeight: "600" },
  entry: { borderTopWidth: 1, borderTopColor: "#e4efeb", paddingTop: 10, gap: 4 },
  entryTitle: { fontWeight: "600", color: "#20443d" },
  entryItem: { color: "#3f5f58" },
  delete: { fontSize: 18 },
});

