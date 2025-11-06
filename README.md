# Farm Bonussystem - Namibia Rinderfarm

Ein integriertes Bonus-Analyse System für Rinderfarmen in Namibia mit EBIT-Berechnung, progressiver Bonusstaffelung und Produktivitätsindex.

## 🚀 Live Demo

**[Zum Tool →](https://pillinio.github.io/farm-bonusrechner/farm_bonussystem_komplett.html)**

## 📊 Features

### EBIT Berechnung
- Herdenparameter (Größe, Schlachtgewicht, Verkaufsrate)
- Preisberechnung pro kg Schlachtgewicht
- Sonstige Einnahmen (Jagd, Pacht)
- Automatische EBIT-Berechnung

### Bonusberechnung (2-Säulen-Modell)

#### Säule 1: EBIT Bonus (70% Gewichtung)
Progressive Staffelung:
- Stufe 1 (0-100k): 8%
- Stufe 2 (100k-500k): 12%
- Stufe 3 (500k-2M): 15%
- Stufe 4 (2M+): 20%

#### Säule 2: Produktivitätsbonus (30% Gewichtung)
Basierend auf Produktivitätsindex (kg Schlachtgewicht pro 1.000 N$ Kosten):
- < 15: Kritisch (Faktor 0×)
- 15-20: Basis (Faktor 1×)
- 20-25: Gut (Faktor 1,5×)
- \> 25: Exzellent (Faktor 2×)

### Zusatzfeatures
- **Skin in the Game**: Investment-basierter Bonus-Multiplikator
- **Auszahlungsstruktur**: Sofort-Auszahlung vs. 3-Jahres-Bonus-Bank
- **Analyse Dashboard**: Interaktive Charts und Vergleichsszenarien

## 💾 Datenverwaltung

### Auto-Save
Alle Eingaben werden automatisch im Browser gespeichert (LocalStorage) und beim nächsten Öffnen wiederhergestellt.

### JSON Export/Import
- **Export**: Speichert alle Parameter als JSON-Datei
- **Import**: Lädt gespeicherte Szenarien
- Perfekt für verschiedene Berechnungsszenarien (z.B. "Konservativ", "Aggressiv")

### PDF Export
Erstellt professionelle Berichte mit:
- Herdenkennzahlen
- EBIT Berechnung
- Produktivitätsindex
- Komplette Bonusberechnung
- Auszahlungsstruktur

## 🛠️ Verwendung

### Online (Empfohlen)
Öffnen Sie einfach die URL in Ihrem Browser - keine Installation erforderlich!

### Lokal
1. Repository klonen: `git clone https://github.com/Pillinio/farm-bonusrechner.git`
2. HTML-Datei im Browser öffnen: `farm_bonussystem_komplett.html`

## 📱 Browser-Kompatibilität

- Chrome/Edge (empfohlen)
- Firefox
- Safari
- Mobile Browser (iOS/Android)

## 🔒 Datenschutz

- Alle Daten bleiben lokal im Browser (LocalStorage)
- Keine Server-Verbindung
- Keine Datenübertragung an Dritte

## 📝 Anleitung für Nutzer

### Schritt 1: EBIT Berechnung
1. Tab "EBIT Berechnung" öffnen
2. Herdenparameter eingeben (Größe, Gewicht, Verkaufsrate, Preis)
3. Optional: Sonstige Einnahmen hinzufügen
4. Betriebskosten eingeben
5. EBIT wird automatisch berechnet

### Schritt 2: Bonusberechnung
1. Tab "Bonusberechnung" öffnen
2. EBIT wird automatisch übernommen
3. Optional: Bonus-Staffelung anpassen
4. Grundgehalt eingeben
5. Optional: Investment eingeben (Skin in the Game)
6. Auszahlungsstruktur festlegen
7. Gesamtbonus wird berechnet

### Schritt 3: Analyse
1. Tab "Analyse Dashboard" öffnen
2. Charts zeigen Bonus-Verläufe
3. Vergleich verschiedener Szenarien
4. Detaillierte Bonus-Tabelle

### Daten speichern/exportieren
- **Auto-Save**: Passiert automatisch bei jeder Änderung
- **JSON Export**: Klick auf "💾 JSON Export" → Datei speichern
- **JSON Import**: Klick auf "📁 JSON Import" → Datei auswählen
- **PDF Export**: Klick auf "📄 PDF Export" → Bericht wird erstellt

## 🔄 Updates

Wenn Sie Änderungen am Tool vornehmen:
```bash
git add .
git commit -m "Beschreibung der Änderung"
git push
```

Nach 1-2 Minuten ist die neue Version für alle Nutzer live!

## 📞 Support

Bei Fragen oder Problemen:
- GitHub Issues: [Issues erstellen](https://github.com/Pillinio/farm-bonusrechner/issues)
- Oder direkter Kontakt

## 📄 Lizenz

Dieses Tool ist für den internen Gebrauch entwickelt.

---

**Entwickelt mit ❤️ für Rinderfarmen in Namibia**
