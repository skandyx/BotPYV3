# Trading Bot Dashboard "BOTPY"

BOTPY is a comprehensive web-based dashboard designed to monitor, control, and analyze a multi-pair automated crypto trading bot operating on USDT pairs. It provides a real-time, user-friendly interface to track market opportunities, manage active positions, review performance, and fine-tune the trading strategy. It supports a phased approach to live trading with `Virtual`, `Real (Paper)`, and `Real (Live)` modes.

## ✨ Key Features

-   **Multiple Trading Modes**: A safe, phased approach to live trading.
    -   `Virtual`: 100% simulation. Safe for testing and strategy optimization.
    -   `Real (Paper)`: Uses real Binance API keys for a live data feed but **simulates** trades without risking capital. The perfect final test.
    -   `Real (Live)`: Executes trades with real funds on your Binance account.
-   **Dynamic Adaptive Profiles**: Instead of a static configuration, the bot can operate as a "Tactical Chameleon". When enabled, it analyzes the market's volatility and trend strength for each specific trade and automatically selects the most effective management profile: "Sniper", "Scalper", or "Volatility Hunter".
-   **Precision "Macro-Micro" Strategy**: Implements a powerful multi-stage strategy that combines long-term trend analysis with precision 1-minute entry triggers to capture explosive breakouts.
-   **Live Dashboard**: Offers an at-a-glance overview of key performance indicators (KPIs) such as balance, open positions, total Profit & Loss (P&L), and win rate.
-   **Real-time Market Scanner**: Displays the results of the market analysis, showing pairs that are potential trade candidates, including ADX and ATR% data used by the adaptive logic.
-   **Detailed Trade History**: Provides a complete log of all past trades with powerful sorting, filtering, and data export (CSV) capabilities.
-   **Fully Configurable**: Every parameter of the strategy is easily adjustable through a dedicated settings page with helpful tooltips.

---

## 🎨 Application Pages & Design

The application is designed with a dark, modern aesthetic (`bg-[#0c0e12]`), using an `Inter` font for readability and `Space Mono` for numerical data. The primary accent color is a vibrant yellow/gold (`#f0b90b`), used for interactive elements and highlights, with green and red reserved for clear financial indicators.

### 🔐 Login Page
-   **Purpose**: Provides secure access to the dashboard.

### 📊 Dashboard
-   **Purpose**: The main control center, providing a high-level summary of the bot's status and performance.
-   **Key Components**: Stat Cards (Balance, Open Positions, P&L), Performance Chart, and an Active Positions Table.

### 📡 Scanner
-   **Purpose**: To display the real-time results of the market analysis, showing which pairs are potential trade candidates.
-   **Layout**: A data-dense table with sortable columns reflecting the strategy.
-   **Key Columns**:
    -   `Symbol`, `Price` (with live green/red flashes).
    -   `Score`: The final strategic score, displayed as a colored badge.
    -   `Conditions`: Visual dots representing the status of each strategic filter.
    -   `Tendance 4h (EMA50)`: Shows if the master trend filter is met.
    -   `RSI 1h`: Displays the 1-hour RSI for the safety filter.
    -   `ADX 15m` & `ATR % 15m`: The key indicators for the Dynamic Profile Selector.

### 📜 History
-   **Purpose**: A dedicated page for reviewing and analyzing the performance of all completed trades.

### ⚙️ Settings
-   **Purpose**: Allows for complete configuration of the bot's strategy, including enabling the "Dynamic Profile Selector" and setting its thresholds.

### 🖥️ Console
-   **Purpose**: Provides a transparent, real-time view into the bot's internal operations with color-coded log levels.

---

# Version Française

## 🧠 Stratégie de Trading : “Le Chasseur de Précision Macro-Micro”

La philosophie du bot est de combiner une analyse **"Macro"** à haute échelle de temps pour trouver des environnements à forte probabilité, avec une analyse **"Micro"** à basse échelle de temps pour identifier le point d'entrée parfait. Cela permet d'éviter le "bruit" des petites unités de temps tout en capturant le début explosif d'un mouvement avec une précision chirurgicale, le tout protégé par des couches de sécurité robustes au niveau du capital.

---

### **Phase 1 : Le Radar Macro (Qualification pour la Hotlist)**

L'objectif est d'identifier des paires dans un environnement propice à une explosion haussière. Une paire qui remplit ces conditions est ajoutée à une **"Hotlist"** (marquée par un `🎯` dans l'UI).

*   **Contexte d'Analyse** : Graphique 15 minutes (15m) et 4 heures (4h).
*   **Condition 1 : Filtre de Tendance Maître (Contexte 4h)**
    *   **Outil** : Moyenne Mobile Exponentielle 50 périodes (MME50).
    *   **Règle** : Le prix de clôture actuel sur le graphique 4h doit être **STRICTEMENT SUPÉRIEUR** à la MME50. ( `Prix > MME50_4h` ).
*   **Condition 2 : Compression de Volatilité (Préparation 15m)**
    *   **Outil** : Bandes de Bollinger (BB).
    *   **Règle** : La paire doit être dans un **"Bollinger Band Squeeze"**. Ceci est défini lorsque la largeur des bandes sur la bougie de 15m *précédente* est dans le quartile inférieur (25%) de ses valeurs sur les 50 dernières périodes.
*   **Action** : Si la `Condition 1` ET la `Condition 2` sont vraies, ajouter le symbole à la **Hotlist**. S'abonner dynamiquement à ses flux de données 1 minute et 5 minutes.

---

### **Phase 2 : Le Déclencheur Micro & Confirmation Multi-couches (Anti-Fakeout)**

Pour les paires sur la Hotlist, le bot analyse chaque bougie d'une minute pour trouver le point d'entrée. Pour être validé, un signal doit passer une série de filtres de confirmation stricts.

*   **Contexte d'Analyse** : Graphique 1 minute (1m) et 5 minutes (5m).
*   **Condition 1 : Basculement du Momentum (L'Étincelle - 1m)**
    *   **Outil** : Moyenne Mobile Exponentielle 9 périodes (MME9).
    *   **Règle** : Une bougie de 1 minute doit **clôturer AU-DESSUS** de la MME9.
*   **Condition 2 : Confirmation par le Volume (Le Carburant - 1m & 5m)**
    *   **Outils** : Volume de trading, On-Balance Volume (OBV), Cumulative Volume Delta (CVD).
    *   **Règle 2a (Volume 1m)** : Le volume de la bougie de déclenchement doit être **supérieur à 1.5 fois** la moyenne du volume récent.
    *   **Règle 2b (OBV 1m)** : L'indicateur **OBV** sur 1 minute doit avoir une pente ascendante, confirmant que la pression acheteuse est réelle et soutenue.
    *   **Règle 2c (CVD 5m)** : L'indicateur **CVD** sur 5 minutes doit avoir une pente ascendante, confirmant que la pression d'achat *nette* (acheteurs - vendeurs) est positive.
*   **Condition 3 : Validation Multi-Temporelle (La Confirmation - 5m)**
    *   **Règle** : Après le signal 1m, le bot met le trade en **attente**. Il attend la clôture de la bougie de 5 minutes en cours. Le trade n'est exécuté que si cette bougie de 5 minutes clôture également de manière haussière et au-dessus du prix de déclenchement initial. **Ceci est le filtre anti "fake breakout" le plus puissant.**
*   **Condition 4 : Filtres de Sécurité Avancés (Anti-Piège)**
    *   **Règle 4a (RSI 1h & 15m)** : Le RSI sur 1 heure ET sur 15 minutes ne doivent pas être en zone de surachat.
    *   **Règle 4b (Mèches)** : La bougie de déclenchement 1m ne doit pas avoir une mèche supérieure anormalement grande (signe de rejet).
    *   **Règle 4c (Parabolique)** : Le prix ne doit pas avoir connu une hausse verticale insoutenable juste avant le signal.
*   **Condition 5 : Confirmation OBV Multi-Échelles (Force Durable - 5m)**
    *   **Règle** : Après la validation de la bougie de 5m (Condition 3), le bot vérifie que l'OBV sur 5 minutes est également en tendance haussière.
*   **Action** : Si toutes les conditions sont remplies, un **signal d'entrée de haute qualité** est généré. Le bot passe à la Phase 2.5.

---

### **Phase 2.5 : Analyse Tactique & Sélection du Profil (Le Cerveau Adaptatif)**

Juste avant d'ouvrir la position, si le mode dynamique est activé, le bot effectue une analyse de la "personnalité" du marché pour choisir la **stratégie de gestion de sortie** la plus appropriée.

*   **Contexte d'Analyse** : Indicateurs 15 minutes (ADX, ATR %).
*   **Matrice de Décision** :
    1.  **Le marché est-il en "Range" ?** (`ADX < Seuil_Range`) -> Sélectionner le profil **"Le Scalpeur"**.
    2.  **Sinon, le marché est-il "Hyper-Volatil" ?** (`ATR % > Seuil_Volatil`) -> Sélectionner le profil **"Le Chasseur de Volatilité"**.
    3.  **Sinon (cas par défaut)** -> Sélectionner le profil **"Le Sniper"**.
*   **Action Finale** : Exécuter l'ordre d'achat avec les paramètres du profil sélectionné.

---

### **Phase 3 : Gestion de Trade & Entrée Intelligente**

*   **Entrées Fractionnées (Scaling In)** : Pour minimiser le risque sur les faux signaux, le bot n'entre pas avec 100% de sa position. Il initie le trade avec une fraction (ex: 40%) et n'ajoute les autres parties (ex: 30%, puis 30%) que si les bougies suivantes confirment la continuation du mouvement.

*   **Gestion de Sortie Progressive (Basée sur le Risque "R")** : La gestion de la sortie est dynamique, surtout pour le profil "Sniper".
    1.  **Stop Loss Initial (Basé sur l'ATR)** : Le Stop Loss est placé intelligemment en fonction de la volatilité du marché (ATR).
    2.  **Mise à Zéro du Risque (à +1R)** : Dès que le profit atteint 1 fois le risque initial (Gain = +1R), le Stop Loss est déplacé au point d'entrée, rendant le trade **sans risque**.
    3.  **Trailing Stop Adaptatif (au-delà de +1R)** : Un Trailing Stop basé sur l'ATR prend le relais. Il se **resserre** automatiquement lorsque le trade atteint des multiples de R supérieurs (ex: +2R), protégeant les gains de manière plus agressive tout en laissant la place au trade de respirer.

---

### **Phase 4 : Sécurité du Portefeuille & Survie à Long Terme (Le Capital est Sacré)**

Ces règles de sécurité ont la priorité sur toutes les stratégies d'entrée.

*   **1. Filtre de Liquidité (Carnet d'Ordres)** : Avant tout trade, le bot vérifie qu'il y a suffisamment de liquidité dans le carnet d'ordres pour éviter le slippage.

*   **2. Détection de Manipulation ("Filtre Anti-Baleine")** : Si une bougie de 1 minute montre un volume anormalement explosif (ex: >5% du volume horaire moyen), le signal est ignoré pour éviter les pièges.

*   **3. Gestion de Corrélation par Secteur** : Pour éviter la surexposition, le bot n'ouvrira qu'un seul trade à la fois par "secteur" crypto (ex: un seul L1, un seul L2, etc.).

*   **4. Mode "Risk-Off" Automatique** : Le bot surveille le sentiment de marché via l'indice **"Fear & Greed"**. Si le marché devient extrêmement euphorique ou paniqué, le trading est automatiquement mis en pause.

*   **5. Filtre de Dominance BTC/ETH** : Le bot surveille en permanence le prix du Bitcoin. Si BTC subit un "dump" violent et soudain (ex: >1.5% en 5 minutes), un **disjoncteur global** s'active, bloquant toute nouvelle entrée.

*   **6. Coupe-Circuits de Capital** :
    *   **Limite de Perte Journalière (Drawdown)** : Si le P&L total de la journée atteint un seuil négatif (ex: -3% du capital), le bot s'arrête complètement jusqu'au lendemain.
    *   **Limite de Pertes Consécutives** : Si le bot enchaîne un nombre défini de trades perdants (ex: 5), il se met en pause temporairement.