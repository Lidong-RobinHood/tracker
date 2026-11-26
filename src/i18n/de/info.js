// de catalogue, namespace 'info'. Flat 'key': 'text' with {placeholders}; see docs/I18N.md.
export default {
  'info.recovery.title': 'Muskelerholung',
  'info.recovery.p1': 'Eine Schätzung, keine Messung. Die Spannen starten mit einer Faustregel: Hart trainierte Muskeln brauchen meist 48–72 h, kleinere weniger, Beine mehr.',
  'info.recovery.p2': 'In Erholung = vor der Spanne · fast erholt = darin · erholt = danach. Tippe auf einen Muskel für einen Check-in; nach etwa {minPoints} Check-ins ist die Spanne deine eigene. Das Tempo skaliert nur die Faustregel.',

  'info.recoveryMath.title': 'Wie Sätze das Fenster verändern',
  'info.recoveryMath.p1': 'Sätze zählen wie bei den Sätzen pro Woche. Die Spannen gelten für {ref} harte Sätze: 1 Satz × {f1}, 8 Sätze × {f8}, 9 oder mehr × {fMax}. Weniger als {minDose} gezählter Satz setzt die Uhr nicht zurück.',
  'info.recoveryMath.p2': 'Trainierst du innerhalb des Fensters erneut, wird die Restbelastung übernommen. Faustregel-Spannen bleiben zwischen {capMin} und {capMax} h, deine zwischen {customMin} und {customMax} h. Nur die letzten {days} Tage zählen.',

  'info.recoveryYours.title': 'Deine Spannen',
  'info.recoveryYours.p1': '„Noch Muskelkater“ heißt, die Erholung dauerte länger; „erholt“ heißt kürzer. Antworten werden auf {ref} Sätze umgerechnet, neuere Trainings zählen mehr, widersprüchliche Antworten innerhalb eines Trainings fallen weg.',
  'info.recoveryYours.p2': 'Nach {minPoints} brauchbaren Check-ins aus {minBouts} Trainings, mit beiden Antworten, wird die Spanne deine: die Mitte deiner Antworten, breiter, solange es wenige sind. Eine von Hand gesetzte Spanne hat weiter Vorrang.',

  'info.sets.title': 'Sätze pro Woche',
  'info.sets.p1': 'Erledigte normale Sätze pro Muskel, Montag bis Sonntag. Direkt (der Muskel ist Hauptbeweger) zählt × {primary}; indirekt (er unterstützt) × {secondary}; Dropsätze × {dropset}.',
  'info.sets.p2': 'Die Faktoren änderst du unter Einstellungen › Satzgewichtung. Mit Ziel zeigt eine Zeile erledigt / Ziel, und der Balken ist bei 100 % voll.',

  'info.setsWorkout.title': 'Sätze pro Muskel',
  'info.setsWorkout.p1': 'Erledigte normale Sätze dieses Trainings pro Muskel. Direkt (der Muskel ist Hauptbeweger) zählt × {primary}; indirekt (er unterstützt) × {secondary}; Dropsätze × {dropset}.',
  'info.setsWorkout.p2': 'Sie zählen zu den Sätzen dieser Woche.',

  'info.tonnage.title': 'Tonnage',
  'info.tonnage.p1': 'Gewicht × Wdh. erledigter normaler Sätze, in kg; ab {tFrom} kg in t (1 t = {tKg} kg). Einzelne Sätze und Übungen immer in kg. Dropsätze stehen getrennt; Sätze mit Körpergewicht zählen 0 kg.',
  'info.tonnage.p2': 'Nach Muskel: Die Tonnage jeder Übung geht zu gleichen Teilen an ihre direkten Muskeln. Routine-Diagramme zeigen die letzten 8 Einheiten; % = Änderung zur Einheit davor.',

  'info.records.title': 'Rekorde',
  'info.records.p1': 'Ein Rekord schlägt jede frühere Einheit dieser Übung: schwerster Satz, Tonnage-Satz, geschätztes 1RM, Tonnage der Einheit oder Wdh. bei Körpergewicht. Nur erledigte normale Sätze zählen. Die erste Einheit setzt die Marke.',
  'info.records.p2': 'Dieser Monat wird mit denselben Tagen im Vormonat verglichen; Startpunkt und nicht beendete Trainings zählen nicht.',

  'info.metrics.title': 'Fortschrittswerte',
  'info.metrics.p1': 'Top-Satz: schwerster erledigter Satz; bei Gleichstand gewinnen mehr Wdh. Geschätztes 1RM (Epley): Gewicht × (1 + Wdh. / 30). Tonnage: Gewicht × Wdh. erledigter Sätze.',
  'info.metrics.p2': 'Beste Wdh.: meiste Wdh. in einem Satz. Wdh. gesamt: alle erledigten Sätze. Dropsätze zählen nie. Körpergewichtsübungen steigern sich über Wdh. Hervorgehobene Punkte sind Rekorde.',

  'info.topExercises.title': 'Top-Übungen',
  'info.topExercises.p1': 'Übungen mit den meisten Einheiten in den letzten 8 Wochen. Wert = bestes geschätztes 1RM der letzten Einheit, bei Körpergewicht die meisten Wdh. in einem Satz. % = Änderung zur ersten Einheit dieser 8 Wochen.',

  'info.progression.title': 'Gewichtsvorschläge',
  'info.progression.p1': 'Alle Zielsätze mit deinem Top-Gewicht müssen die Ziel-Wdh. erreichen (das obere Ende einer Spanne wie 3 × 6–8); dann schlägt ein Chip dieses Gewicht + den Gewichtsschritt vor. Leichtere Aufwärm- und Back-off-Sätze zählen nicht, Dropsätze nie, und der Startpunkt löst nie einen Vorschlag aus.',
  'info.progression.p2': 'Nichts ändert sich, bis du auf den Chip tippst. Gewichtsschritt 0 = keine Vorschläge.',

  'info.starting.title': 'Startpunkt',
  'info.starting.p1': 'Dein aktuelles Arbeitsgewicht × Wdh. × Sätze pro Übung, dazu dein bester Satz, falls er abweicht. Füllt Einheiten vor und zählt für Rekorde.',
  'info.starting.p2': 'Er ist nie ein Training und löst nie einen Gewichtsvorschlag aus; dafür braucht es eine echte Einheit.',

  'info.photo.title': 'Schätzung per Mahlzeitenfoto',
  'info.photo.p1': 'Ein KI-Modell schätzt Lebensmittel, Gramm, Kalorien und Makros anhand des Fotos. Das sind Schätzungen: Prüfe sie vor dem Hinzufügen.',
  'info.photo.p2': 'Jede Analyse wird über dein eigenes Anbieterkonto abgerechnet; auch eine abgebrochene Anfrage kann berechnet werden. Gesendet werden nur das Foto (max. {px} px) und dein Hinweis.',
  'info.photo.p3': 'Manche Anbieter blockieren Aufrufe aus dem Browser; Organisationen mit Zero Data Retention können Anthropic nicht aus dem Browser aufrufen.',

  'info.camera.title': 'Kamera erlauben',
  'info.camera.p1': 'iPhone: Einstellungen › Safari › Kamera, oder das aA-Menü in der Adressleiste. Android: Schloss-Symbol in der Adressleiste › Berechtigungen. Tippe dann erneut auf „Scannen“.',

  'info.expenditure.title': 'Verbrauch',
  'info.expenditure.p1': 'Durchschnittliche kcal / Tag, die du verbrauchst, inklusive Training. Aus deinen Daten: geschätzt aus erfassten Lebensmitteln und dem Gewichtstrend.',
  'info.expenditure.p2': 'Nötig sind in den letzten {windowDays} Tagen {minWeighIns} Messungen und {minLoggedDays} vollständige Tage, dazu {minSpanDays} Tage Verlauf und eine Messung in den letzten {maxStaleDays} Tagen. Bis dahin: Formel (Mifflin-St Jeor × Aktivität) aus deinem Profil. Ausgelassene Tage machen den Wert zu niedrig.',

  'info.checkin.title': 'Wöchentlicher Check-in',
  'info.checkin.p1': 'Jeden Montag schlägt Trends aus deinem Verbrauch und Ziel Kalorienziele für die Woche vor. „Annehmen“ wendet sie an; „Beibehalten“ ändert nichts.',
  'info.checkin.p2': 'Änderungen sind auf {maxChange} kcal / Woche begrenzt und gehen nie unter die Kalorienuntergrenze.',

  'info.complete.title': 'Vollständige Tage',
  'info.complete.p1': 'Heute zählt nie. Ein erfasster Tag unter der Hälfte deiner üblichen Aufnahme (Median der erfassten Tage innerhalb ± {weeks} Wochen) ist unvollständig, wahrscheinlich nicht ganz erfasst.',
  'info.complete.p2': 'Unvollständige Tage fehlen in Durchschnitten, Tagen im Ziel, höchstem und niedrigstem Tag, Summen und der Verbrauchsschätzung. Im Ziel = ein vollständiger Tag innerhalb ± 10 % des Kalorienziels.',

  'info.trend.title': 'Gewichtstrend',
  'info.trend.p1': 'Ein gleitender Durchschnitt, der tägliche Wasserschwankungen glättet. Achte auf den Trend, nicht auf einzelne Tage. Wiege dich jeden Morgen, nach der Toilette und vor dem Essen.',
  'info.trend.p2': 'Der Trend beginnt mit der zweiten Messung. Die Wochenänderung vergleicht mit dem Trend am Ende des vorigen Sonntags.',

  'info.report.title': 'Wochenbericht',
  'info.report.p1': 'Wochen laufen von Montag bis Sonntag; nur Wochen mit Einträgen stehen in der Liste. Änderung = (diese − letzte) / letzte; –, wenn die letzte Woche keinen Wert hat.',
  'info.report.p2': 'Ziele stammen aus dem Check-in der jeweiligen Woche. Manuelle Zieländerungen werden nicht gespeichert, daher können vergangene Wochen andere Ziele zeigen als die, die du hattest.',

  'info.macros.title': 'Makro-Anteile',
  'info.macros.p1': 'Eiweiß und Kohlenhydrate 4 kcal / g, Fett 9 kcal / g. Gramm werden auf ganze Zahlen gerundet.',
  'info.macros.p2': 'Die Anteile im Wochenbericht nutzen nur vollständige Tage.',

  'info.adaptiveMacros.title': 'Adaptive Makros',
  'info.adaptiveMacros.p1': 'Eiweiß und Fett werden in g / kg Trendgewicht festgelegt; Kohlenhydrate füllen den Rest.',
  'info.adaptiveMacros.p2': 'Kalorienuntergrenze: das niedrigste Ziel, das je vorgeschlagen wird. Leer = {female} kcal für Frauen, {male} für Männer, sonst {unknown}.',
  'info.adaptiveMacros.p3': 'Bei einer Aufteilung in Prozent ändern Check-ins nur die Kalorien, und diese Werte werden nicht genutzt.',

  'info.goal.title': 'Gewichtsziel',
  'info.goal.p1': 'Abnehmen bis {lose} kg oder zunehmen bis {gain} kg / Woche. Die kcal-Zahl ist die tägliche Differenz zu deinem Verbrauch, die dieses Tempo braucht, bei {kcalPerKg} kcal / kg.',
  'info.goal.p2': 'Der wöchentliche Check-in nutzt es, um Ziele vorzuschlagen.',

  'info.backup.title': 'Backup',
  'info.backup.p1': 'Alle Daten liegen nur in diesem Browser auf diesem Gerät: kein Konto, keine Cloud, keine Synchronisierung. Exportiere regelmäßig ein Backup und bewahre die Datei woanders auf, etwa in einem Cloud-Speicher oder per E-Mail an dich selbst.',
  'info.backup.p2': 'Neues Handy: Hier „Backup exportieren“, dort „Backup importieren“; das ersetzt alles. API-Schlüssel sind nicht im Backup. Die App erinnert dich nach {days} Tagen.',

  'info.storage.title': 'Speicherschutz',
  'info.storage.p1': 'Geschützt: Der Browser löscht die Daten nicht von selbst; Websitedaten löschen oder die App entfernen tut es trotzdem.',
  'info.storage.p2': 'Nicht geschützt: Der Browser kann die Daten löschen, wenn der Speicher knapp wird. Die App zu installieren und Backups zu machen hilft.',

  'info.importWeights.title': 'Format der Gewichtsdatei',
  'info.importWeights.p1': 'Datumsangaben wie 12.11.2026, 2026-11-12, 12/11/26 oder Mon 12 Nov. Gewichte wie 82,5 oder 82.5, in kg; Pfund werden nicht unterstützt.',
  'info.importWeights.p2': 'Spalten getrennt durch Tab, Semikolon, Komma oder Leerzeichen, in beliebiger Reihenfolge. Eine Kopfzeile ist kein Problem.',

  'info.importWorkouts.title': 'Format zum Einfügen',
  'info.importWorkouts.p1': 'Übungsname in einer eigenen Zeile, dann 3 × 6 (Sätze × Wdh.). Dann eine Zeile pro Satz: kg und Wdh., getrennt durch ein Leerzeichen, nicht durch ein Komma (80 6). Dropsatz 5x 80 = 5 Wdh. mit 80 kg. Eine einzelne Zahl = Wdh. mit Körpergewicht.',
  'info.importWorkouts.p2': 'Eine Datumszeile beginnt ein neues Training; eine Zeile wie Push benennt es. Tabellen nebeneinander: Kopiere jeweils eine Spaltengruppe.',

  'info.splitChoose.title': 'Split wählen',
  'info.splitChoose.p1': 'Wähle so viele Tage, wie du über Monate durchhältst. Bei gleichen Sätzen pro Woche finden Studien für Ganzkörper, Ober-/Unterkörper und andere Splits ähnliche Ergebnisse.',
  'info.splitChoose.p2': 'Weniger Tage: Ganzkörper. Vier: Ober-/Unterkörper. Fünf oder sechs: Hybrid oder Push / Pull / Beine. Jeder Muskel etwa zweimal pro Woche ist ein einfacher Standard.',

  'info.splitRun.title': 'Split durchführen',
  'info.splitRun.p1': 'Mach die Einheiten der Reihe nach; „Als Nächstes“ zeigt die fällige. Ruhe einen Tag, bevor du dieselben Muskeln wieder trainierst.',
  'info.splitRun.p2': 'Alle Sätze am oberen Ende der Wdh.-Spanne? Nächstes Mal mehr Gewicht; sonst eine Wdh. mehr. Tausche eine Übung gegen eine mit demselben Hauptmuskel. Stillstand? Mach eine leichte Woche mit halb so vielen Sätzen.',

  'info.splitSets.title': 'Sätze pro Woche',
  'info.splitSets.p1': 'Geplante Sätze pro Muskel in einer Woche. Direkt (Hauptbeweger) zählt × {primary}, indirekt (unterstützt) × {secondary}, wie in deinem Verlauf.',
  'info.splitSets.p2': 'Die Sätze pro Woche zählen am meisten; mehr bringt meist etwas mehr, mit abnehmendem Ertrag. Spannen sind allgemeine Richtwerte, keine Vorgaben. Erhöhe die Sätze nur, wenn du dich erholst und weiter Fortschritte machst.',
};
