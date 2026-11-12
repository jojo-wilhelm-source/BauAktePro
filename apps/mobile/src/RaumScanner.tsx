/**
 * Scan a room QR label (decided 12.11.2026): returns the room id. Used when creating a Mangel (and the coming
 * photo documentation). Only codes of this app are accepted; the room must exist on the device (offline).
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { raumAusCode } from '@bap/domain';
import { C, T } from './theme';
import { SheetBar } from './ui';

export function RaumScanner({ known, onRoom, onClose }: { known: (id: string) => string | null; onRoom: (id: string) => void; onClose: () => void }) {
  const [perm, request] = useCameraPermissions();
  const [hint, setHint] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const scanned = (data: string) => {
    if (done) return;
    const id = raumAusCode(data);
    if (!id) return setHint('Das ist kein Raum-Etikett von Bau Akte Pro.');
    if (!known(id)) return setHint('Dieser Raum gehört nicht zum gewählten Projekt.');
    setDone(true);
    onRoom(id);
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <SheetBar title="Raum scannen" left="Abbrechen" onLeft={onClose} />
      {!perm ? null : !perm.granted ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg, padding: 24 }}>
          <Text style={[T.body, { textAlign: 'center' }]}>Für das Scannen der Raum-Etiketten braucht die App die Kamera.</Text>
          <Pressable onPress={() => void request()}><Text style={[T.body, { color: C.accent, fontWeight: '600' }]}>Kamera erlauben</Text></Pressable>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => scanned(data)} />
          <View pointerEvents="none" style={{ position: 'absolute', top: '30%', alignSelf: 'center', width: 240, height: 240, borderWidth: 3, borderColor: '#fff', borderRadius: 24, opacity: 0.85 }} />
          <View style={{ position: 'absolute', bottom: 40, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, padding: 14 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontSize: 15 }}>{hint ?? 'QR-Code am Raum-Etikett in den Rahmen halten'}</Text>
          </View>
        </View>
      )}
    </View>
  );
}
