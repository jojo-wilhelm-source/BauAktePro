import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { API_URL } from './config';
import type { MangelRow } from './schema';
import { AMPEL_TINT, C, TINT } from './theme';

interface Props {
  planId: string;
  token: string;
  maengel: (MangelRow & { id: string })[];
  ampel: (m: MangelRow) => 'gruen' | 'gelb' | 'rot' | 'grau';
  onSelect: (id: string) => void;
  onPick: (pos: { page: number; x: number; y: number }) => void;
}

const PIN = 30;

/** Map-style pin: a rounded square with one sharp corner, rotated so the tip points at the spot. */
function Pin({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.pin, { backgroundColor: color }]}>
      <Text style={styles.pinText}>{label}</Text>
    </View>
  );
}

/**
 * Plan with pins. The page is shown fitted to the width without zoom, so pins can be overlaid with
 * relative coordinates. Zoom + pins comes with the native PDFKit view (next step, docs/fachkonzept/04).
 * The file is cached on the device (cache: true) and stays available offline after the first load.
 */
export function PlanScreen({ planId, token, maengel, ampel, onSelect, onPick }: Props) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const height = box && ratio ? Math.min(box.w / ratio, box.h) : 0;
  const width = box && ratio ? height * ratio : 0;

  return (
    <View style={styles.wrap} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {error && <Text style={styles.error}>Plan nicht verfügbar: {error}</Text>}
      {box && (
        <View style={{ width: width || box.w, height: height || box.h, alignSelf: 'center' }}>
          <Pdf
            source={{ uri: `${API_URL}/plans/${planId}/file`, headers: { authorization: `Bearer ${token}` }, cache: true }}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
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
            <Pressable style={StyleSheet.absoluteFill} onPress={(e) => onPick({ page: 1, x: e.nativeEvent.locationX / width, y: e.nativeEvent.locationY / height })}>
              {maengel
                .filter((m) => m.plan_id === planId && m.pin_x != null && m.pin_y != null)
                .map((m) => (
                  <Pressable
                    key={m.id}
                    hitSlop={8}
                    onPress={() => onSelect(m.id)}
                    // Tip of the rotated pin sits PIN·√2/2 below its centre.
                    style={{ position: 'absolute', left: m.pin_x! * width - PIN / 2, top: m.pin_y! * height - PIN * 1.2 }}
                  >
                    <Pin color={TINT[AMPEL_TINT[ampel(m)]]} label={m.number ? String(m.number) : '•'} />
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
  wrap: { flex: 1, backgroundColor: C.card, justifyContent: 'center' },
  error: { color: C.red, padding: 12 },
  pin: {
    width: PIN,
    height: PIN,
    borderTopLeftRadius: PIN / 2,
    borderTopRightRadius: PIN / 2,
    borderBottomLeftRadius: PIN / 2,
    borderBottomRightRadius: 2,
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  pinText: { color: '#fff', fontWeight: '700', fontSize: 12, transform: [{ rotate: '-45deg' }] },
});
