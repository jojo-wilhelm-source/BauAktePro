import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { API_URL } from './config';
import type { MangelRow } from './schema';

interface Props {
  planId: string;
  token: string;
  maengel: (MangelRow & { id: string })[];
  ampel: (m: MangelRow) => 'gruen' | 'gelb' | 'rot' | 'grau';
  onSelect: (id: string) => void;
  onPick: (pos: { page: number; x: number; y: number }) => void;
}

const COLORS = { rot: '#d92d20', gelb: '#f5b400', gruen: '#12a150', grau: '#98a2b3' };

/**
 * Plan with pins. DURCHSTICH: the page is shown fitted to the width without zoom, so pins can be
 * overlaid with relative coordinates. Zoom + pins needs a native PDFKit view (see docs/tech-stack.md, risks).
 * The file is cached on the device (cache: true) and stays available offline after the first load.
 */
export function PlanScreen({ planId, token, maengel, ampel, onSelect, onPick }: Props) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const height = box && ratio ? box.w / ratio : 0;

  return (
    <View style={styles.wrap} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {error && <Text style={styles.error}>Plan nicht verfügbar: {error}</Text>}
      {box && (
        <View style={{ width: box.w, height: height || box.h }}>
          <Pdf
            source={{ uri: `${API_URL}/plans/${planId}/file`, headers: { authorization: `Bearer ${token}` }, cache: true }}
            style={StyleSheet.absoluteFill}
            singlePage
            scale={1}
            minScale={1}
            maxScale={1}
            fitPolicy={0}
            trustAllCerts={false}
            onLoadComplete={(_n, _path, size) => setRatio(size.width / size.height)}
            onError={(e) => setError(String((e as Error)?.message ?? e))}
            renderActivityIndicator={() => <ActivityIndicator />}
          />
          {height > 0 && (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={(e) => onPick({ page: 1, x: e.nativeEvent.locationX / box.w, y: e.nativeEvent.locationY / height })}
            >
              {maengel
                .filter((m) => m.plan_id === planId && m.pin_x != null && m.pin_y != null)
                .map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => onSelect(m.id)}
                    style={[styles.pin, { left: m.pin_x! * box.w - 16, top: m.pin_y! * height - 16, backgroundColor: COLORS[ampel(m)] }]}
                  >
                    <Text style={styles.pinText}>{m.number ?? '•'}</Text>
                  </Pressable>
                ))}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  error: { color: '#d92d20', padding: 12 },
  pin: { position: 'absolute', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  pinText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
