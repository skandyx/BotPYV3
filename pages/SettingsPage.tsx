import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/mockApi';
import { BotSettings } from '../types';
import Spinner from '../components/common/Spinner';
import { useAppContext } from '../contexts/AppContext';
import ToggleSwitch from '../components/common/ToggleSwitch';
import Tooltip from '../components/common/Tooltip';
import Modal from '../components/common/Modal';

// --- TYPES & PROFILES ---
type ProfileName = 'Le Sniper' | 'Le Scalpeur' | 'Le Chasseur de Volatilité';
type ActiveProfile = ProfileName | 'PERSONNALISE';

const profileTooltips: Record<ProfileName, string> = {
    'Le Sniper': "PRUDENT : Vise la qualité maximale. Filtres très stricts et gestion 'Profit Runner' pour laisser courir les gagnants au maximum.",
    'Le Scalpeur': "ÉQUILIBRÉ : Optimisé pour des gains rapides et constants. Ratio Risque/Récompense faible, idéal pour les marchés en range.",
    'Le Chasseur de Volatilité': "AGRESSIF : Conçu pour les marchés explosifs. Utilise un mode d'entrée rapide et une gestion du risque adaptée à une forte volatilité."
};

const settingProfiles: Record<ProfileName, Partial<BotSettings>> = {
    'Le Sniper': { // PRUDENT
        POSITION_SIZE_PCT: 2.0,
        MAX_OPEN_POSITIONS: 3,
        REQUIRE_STRONG_BUY: true,
        USE_RSI_SAFETY_FILTER: true,
        RSI_OVERBOUGHT_THRESHOLD: 65,
        USE_PARABOLIC_FILTER: true,
        PARABOLIC_FILTER_PERIOD_MINUTES: 5,
        PARABOLIC_FILTER_THRESHOLD_PCT: 2.5,
        USE_ATR_STOP_LOSS: true,
        ATR_MULTIPLIER: 1.5,
        USE_PARTIAL_TAKE_PROFIT: true,
        PARTIAL_TP_TRIGGER_PCT: 0.8,
        PARTIAL_TP_SELL_QTY_PCT: 50,
        USE_AUTO_BREAKEVEN: true,
        BREAKEVEN_TRIGGER_R: 1.0,
        ADJUST_BREAKEVEN_FOR_FEES: true,
        TRANSACTION_FEE_PCT: 0.1,
        USE_ADAPTIVE_TRAILING_STOP: true,
        TRAILING_STOP_TIGHTEN_THRESHOLD_R: 1.5,
        TRAILING_STOP_TIGHTEN_MULTIPLIER_REDUCTION: 0.5,
        RISK_REWARD_RATIO: 5.0,
        USE_AGGRESSIVE_ENTRY_LOGIC: false,
    },
    'Le Scalpeur': { // EQUILIBRE
        POSITION_SIZE_PCT: 3.0,
        MAX_OPEN_POSITIONS: 5,
        REQUIRE_STRONG_BUY: false,
        USE_RSI_SAFETY_FILTER: true,
        RSI_OVERBOUGHT_THRESHOLD: 70,
        USE_PARABOLIC_FILTER: true,
        PARABOLIC_FILTER_PERIOD_MINUTES: 5,
        PARABOLIC_FILTER_THRESHOLD_PCT: 3.5,
        USE_ATR_STOP_LOSS: false,
        STOP_LOSS_PCT: 2.0,
        RISK_REWARD_RATIO: 0.75,
        USE_PARTIAL_TAKE_PROFIT: false,
        USE_AUTO_BREAKEVEN: false,
        ADJUST_BREAKEVEN_FOR_FEES: false,
        TRANSACTION_FEE_PCT: 0.1,
        USE_ADAPTIVE_TRAILING_STOP: false,
        USE_AGGRESSIVE_ENTRY_LOGIC: false,
    },
    'Le Chasseur de Volatilité': { // AGRESSIF
        POSITION_SIZE_PCT: 4.0,
        MAX_OPEN_POSITIONS: 8,
        REQUIRE_STRONG_BUY: false,
        USE_RSI_SAFETY_FILTER: false,
        RSI_OVERBOUGHT_THRESHOLD: 80,
        USE_PARABOLIC_FILTER: false,
        USE_ATR_STOP_LOSS: true,
        ATR_MULTIPLIER: 2.0,
        RISK_REWARD_RATIO: 3.0,
        USE_PARTIAL_TAKE_PROFIT: false,
        USE_AUTO_BREAKEVEN: true,
        BREAKEVEN_TRIGGER_R: 2.0,
        ADJUST_BREAKEVEN_FOR_FEES: true,
        TRANSACTION_FEE_PCT: 0.1,
        USE_ADAPTIVE_TRAILING_STOP: true,
        TRAILING_STOP_TIGHTEN_THRESHOLD_R: 1.0,
        TRAILING_STOP_TIGHTEN_MULTIPLIER_REDUCTION: 0.5,
        USE_AGGRESSIVE_ENTRY_LOGIC: true, // Specific to this profile
    }
};


// --- HELPERS ---
const tooltips: Record<string, string> = {
    INITIAL_VIRTUAL_BALANCE: "Le capital de départ pour votre compte de trading virtuel. Ce montant est appliqué lorsque vous effacez toutes les données de trading.",
    MAX_OPEN_POSITIONS: "Le nombre maximum de trades que le bot peut avoir ouverts en même temps. Aide à contrôler l'exposition globale au risque.",
    POSITION_SIZE_PCT: "Le pourcentage de votre solde total à utiliser pour chaque nouveau trade. (ex: 2% sur un solde de 10 000 $ se traduira par des positions de 200 $).",
    RISK_REWARD_RATIO: "Le multiplicateur de votre risque pour définir l'objectif de profit. Un ratio de 3.0 signifie que le Take Profit sera fixé à 3 fois la distance du Stop Loss.",
    STOP_LOSS_PCT: "Le pourcentage de perte auquel un trade sera automatiquement clôturé pour éviter de nouvelles pertes. C'est le risque maximum par trade.",
    USE_TRAILING_STOP_LOSS: "Active un stop loss dynamique qui monte pour sécuriser les profits à mesure que le prix augmente, mais ne descend jamais.",
    TRAILING_STOP_LOSS_PCT: "Le pourcentage en dessous du prix le plus élevé auquel le trailing stop loss sera fixé. Une valeur plus petite est plus serrée, une valeur plus grande est plus lâche.",
    SLIPPAGE_PCT: "Un petit pourcentage pour simuler la différence entre le prix d'exécution attendu et réel d'un trade sur un marché en direct.",
    MIN_VOLUME_USD: "Le volume de trading minimum sur 24 heures qu'une paire doit avoir pour être prise en compte par le scanner. Filtre les marchés illiquides.",
    SCANNER_DISCOVERY_INTERVAL_SECONDS: "La fréquence (en secondes) à laquelle le bot doit effectuer un scan complet du marché pour découvrir et analyser les paires en fonction de leurs données graphiques sur 4h.",
    USE_VOLUME_CONFIRMATION: "Si activé, une cassure (breakout) n'est valide que si le volume est significativement supérieur à sa moyenne récente, confirmant l'intérêt du marché.",
    USE_MARKET_REGIME_FILTER: "Un filtre maître. Si activé, le bot ne tradera que si la structure du marché à long terme (basée sur les MA 50/200 sur le graphique 4h) est dans une TENDANCE HAUSSIÈRE confirmée.",
    REQUIRE_STRONG_BUY: "Si activé, le bot n'ouvrira de nouvelles transactions que pour les paires avec un score 'STRONG BUY'. Il ignorera les paires avec un score 'BUY' régulier, rendant la stratégie plus sélective.",
    LOSS_COOLDOWN_HOURS: "Anti-Churn : Si une transaction sur un symbole est clôturée à perte, le bot sera empêché de trader ce même symbole pendant ce nombre d'heures.",
    EXCLUDED_PAIRS: "Une liste de paires séparées par des virgules à ignorer complètement, quel que soit leur volume (par exemple, USDCUSDT,FDUSDUSDT).",
    BINANCE_API_KEY: "Votre clé API publique Binance. Requise pour les modes de trading live et paper.",
    BINANCE_SECRET_KEY: "Votre clé API secrète Binance. Elle est stockée en toute sécurité sur le serveur et n'est jamais exposée au frontend.",
    USE_ATR_STOP_LOSS: "Utiliser un Stop Loss dynamique basé sur l'Average True Range (ATR), qui s'adapte à la volatilité du marché au lieu d'un pourcentage fixe.",
    ATR_MULTIPLIER: "Le multiplicateur à appliquer à la valeur ATR pour définir la distance du Stop Loss (ex: 1.5 signifie que le SL sera à 1.5 * ATR en dessous du prix d'entrée).",
    USE_AUTO_BREAKEVEN: "Déplacer automatiquement le Stop Loss au prix d'entrée une fois qu'un trade est en profit, éliminant le risque de perte.",
    BREAKEVEN_TRIGGER_R: "Le multiple de risque (R) à atteindre pour déclencher le passage au seuil de rentabilité (ex: 1.0 signifie que lorsque le profit atteint 1x le risque initial, le SL est déplacé au prix d'entrée).",
    ADJUST_BREAKEVEN_FOR_FEES: "Si activé, le 'Break-Even' sera légèrement au-dessus du prix d'entrée pour couvrir les frais de transaction de l'achat et de la vente, assurant une sortie à 0$ P&L net.",
    TRANSACTION_FEE_PCT: "Le pourcentage de frais de transaction par ordre sur votre exchange (ex: 0.1 pour 0.1%). Utilisé pour calculer le point de Break-Even réel.",
    USE_RSI_SAFETY_FILTER: "Empêcher l'ouverture de nouveaux trades si le RSI est dans la zone de 'surachat', évitant d'acheter à un potentiel sommet local.",
    RSI_OVERBOUGHT_THRESHOLD: "Le niveau RSI au-dessus duquel un signal de trade sera ignoré (ex: 70).",
    USE_PARTIAL_TAKE_PROFIT: "Vendre une partie de la position à un objectif de profit préliminaire et laisser le reste courir avec le trailing stop loss.",
    PARTIAL_TP_TRIGGER_PCT: "Le pourcentage de profit (%) auquel vendre la première partie de la position.",
    PARTIAL_TP_SELL_QTY_PCT: "Le pourcentage (%) de la quantité de position initiale à vendre pour la prise de profit partielle.",
    USE_DYNAMIC_POSITION_SIZING: "Allouer une taille de position plus importante pour les signaux 'STRONG BUY' de la plus haute qualité par rapport aux signaux 'BUY' réguliers.",
    STRONG_BUY_POSITION_SIZE_PCT: "Le pourcentage de votre solde à utiliser pour un signal 'STRONG BUY' si le dimensionnement dynamique est activé.",
    USE_PARABOLIC_FILTER: "Active un filtre de sécurité pour éviter d'ouvrir des trades sur des mouvements de prix soudains et verticaux (paraboliques), qui sont souvent des pièges de liquidité.",
    PARABOLIC_FILTER_PERIOD_MINUTES: "La période (en minutes) sur laquelle vérifier une hausse de prix parabolique avant d'entrer dans un trade.",
    PARABOLIC_FILTER_THRESHOLD_PCT: "Le pourcentage maximum d'augmentation de prix autorisé sur la période de vérification. Si le prix a augmenté plus que ce seuil, le trade est ignoré pour éviter d'entrer sur un pic insoutenable.",
    USE_DYNAMIC_PROFILE_SELECTOR: "Si activé, le bot choisira automatiquement le meilleur profil (Sniper, Scalpeur, Chasseur) pour chaque trade en fonction des conditions de marché (tendance, volatilité) au moment de l'entrée.",
    ADX_THRESHOLD_RANGE: "Le seuil ADX (15m) en dessous duquel un marché est considéré comme étant en 'range' (faible tendance), déclenchant le profil 'Scalpeur'.",
    ATR_PCT_THRESHOLD_VOLATILE: "Le seuil de l'ATR (en % du prix) au-dessus duquel un marché est considéré comme hyper-volatil, déclenchant le profil 'Chasseur de Volatilité'.",
    USE_AGGRESSIVE_ENTRY_LOGIC: "Permet une entrée plus rapide basée uniquement sur le momentum 1m (EMA9 + Volume), sans attendre la confirmation structurelle 15m. Utilisé par le profil 'Chasseur de Volatilité'.",
    USE_ADAPTIVE_TRAILING_STOP: "Rend le stop suiveur plus intelligent en le resserrant à mesure que le trade devient plus profitable, pour sécuriser les gains de manière plus agressive.",
    TRAILING_STOP_TIGHTEN_THRESHOLD_R: "Le multiple de risque (R) à atteindre pour que le stop suiveur se resserre. Ex: 1.5 signifie que lorsque le trade atteint +1.5R de profit, le stop se resserre.",
    TRAILING_STOP_TIGHTEN_MULTIPLIER_REDUCTION: "La valeur de réduction du multiplicateur ATR une fois le seuil de resserrement atteint. Ex: 0.5 réduira un multiplicateur de 1.5 à 1.0.",
    CIRCUIT_BREAKER_WARN_THRESHOLD_PCT: "Le pourcentage de chute de BTC sur 5 minutes qui déclenche une alerte. Le bot réduira la taille des nouvelles positions.",
    CIRCUIT_BREAKER_HALT_THRESHOLD_PCT: "Le pourcentage de chute de BTC sur 5 minutes qui déclenche un arrêt complet. Le bot clôturera toutes les positions et arrêtera le trading.",
    DAILY_DRAWDOWN_LIMIT_PCT: "Le risque maximum sur le capital par jour. Si les pertes de la journée dépassent ce pourcentage du solde initial, le bot s'arrête jusqu'au lendemain.",
    CONSECUTIVE_LOSS_LIMIT: "Le nombre maximum de pertes consécutives autorisées. Si cette limite est atteinte, le bot se met en pause pour éviter de trader dans de mauvaises conditions de marché.",
    USE_MTF_VALIDATION: "Validation Multi-Temporelle : Après un signal 1m, attendre la clôture d'une bougie 5m haussière pour confirmer le breakout avant d'entrer. Réduit considérablement les fausses cassures.",
    USE_OBV_VALIDATION: "Confirmation par Volume (OBV) : Exiger que l'indicateur On-Balance Volume (1m) soit en hausse lors du signal de breakout. Confirme que le volume acheteur réel soutient le mouvement.",
    USE_CVD_FILTER: "Confirmation par Delta de Volume Cumulé (CVD) : Exige que la pression nette acheteuse (CVD) soit en augmentation sur le graphique 5 minutes, confirmant que le breakout est soutenu par un flux d'ordres entrants.",
    SCALING_IN_CONFIG: "Définit la stratégie d'entrées fractionnées. Ex: '50,50' pour 2 entrées de 50% chacune, ou '40,30,30' pour 3 entrées. Laissez vide pour désactiver.",
    MAX_CORRELATED_TRADES: "Le nombre maximum de trades sur des altcoins (corrélés à BTC) autorisés à être ouverts simultanément pour éviter une surexposition.",
    USE_FEAR_AND_GREED_FILTER: "Activer le mode 'Risk-Off' automatique. Le bot se mettra en pause si le sentiment du marché devient extrême (peur ou euphorie), selon l'indice Fear & Greed.",
    USE_ORDER_BOOK_LIQUIDITY_FILTER: "Vérifier la profondeur du carnet d'ordres pour une liquidité suffisante avant d'entrer dans un trade afin d'éviter le slippage.",
    MIN_ORDER_BOOK_LIQUIDITY_USD: "La quantité minimale de liquidité (en USD) qui doit être disponible dans ±0.5% du prix actuel pour que le trade soit autorisé.",
    USE_SECTOR_CORRELATION_FILTER: "Empêcher d'ouvrir des trades sur plusieurs actifs du même secteur (ex: L1, L2, DeFi) simultanément pour améliorer la diversification.",
    USE_WHALE_MANIPULATION_FILTER: "Détecter et ignorer les signaux d'entrée causés par des pics de volume anormaux sur une seule bougie, qui sont souvent des pièges.",
    WHALE_SPIKE_THRESHOLD_PCT: "Le pourcentage du volume horaire moyen. Si une bougie de 1 minute dépasse ce seuil (ex: 5%), le signal est considéré comme une manipulation.",
    USE_RSI_MTF_FILTER: "Filtre de Sécurité RSI Multi-Temporel : Vérifie que le RSI sur 15 minutes n'est pas déjà en zone de surchauffe, pour éviter les entrées tardives.",
    RSI_15M_OVERBOUGHT_THRESHOLD: "Le seuil RSI sur 15 minutes au-delà duquel un signal d'achat sera ignoré.",
    USE_WICK_DETECTION_FILTER: "Filtre Anti-Piège : rejette les signaux d'entrée si la bougie de déclenchement a une mèche supérieure anormalement grande, indiquant un rejet du prix.",
    MAX_UPPER_WICK_PCT: "Le pourcentage maximum de la mèche supérieure par rapport à la taille totale de la bougie. Au-delà de ce seuil, le signal est ignoré.",
    USE_OBV_5M_VALIDATION: "Confirmation de Volume Multi-Échelles : Exige que la tendance de l'OBV soit également haussière sur l'unité de temps de 5 minutes après la confirmation, pour éviter les divergences."
};

const inputClass = "mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white";

const SettingsPage: React.FC = () => {
    const { settings: contextSettings, setSettings: setContextSettings, incrementSettingsActivity, refreshData } = useAppContext();
    const [settings, setSettings] = useState<BotSettings | null>(contextSettings);
    const [activeProfile, setActiveProfile] = useState<ActiveProfile>('PERSONNALISE');
    const [isSaving, setIsSaving] = useState(false);
    const [isTestingBinance, setIsTestingBinance] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);

    useEffect(() => {
        if (contextSettings) {
            setSettings(contextSettings);
        }
    }, [contextSettings]);

    // Effect to detect the current profile based on settings
    useEffect(() => {
        if (!settings || settings.USE_DYNAMIC_PROFILE_SELECTOR) {
            setActiveProfile('PERSONNALISE');
            return;
        }

        const checkProfile = (profile: Partial<BotSettings>): boolean => {
            return Object.keys(profile).every(key => {
                const settingKey = key as keyof BotSettings;
                if (!settings.hasOwnProperty(settingKey)) return false; // Ensure the key exists on the main settings object
                // Handle potential floating point inaccuracies for numeric comparisons
                if (typeof settings[settingKey] === 'number' && typeof profile[settingKey] === 'number') {
                     return Math.abs((settings[settingKey] as number) - (profile[settingKey] as number)) < 0.001;
                }
                return settings[settingKey] === profile[settingKey];
            });
        };

        let currentProfile: ActiveProfile = 'PERSONNALISE';
        if (checkProfile(settingProfiles['Le Sniper'])) {
            currentProfile = 'Le Sniper';
        } else if (checkProfile(settingProfiles['Le Scalpeur'])) {
            currentProfile = 'Le Scalpeur';
        } else if (checkProfile(settingProfiles['Le Chasseur de Volatilité'])) {
            currentProfile = 'Le Chasseur de Volatilité';
        }
        
        if (currentProfile !== activeProfile) {
            setActiveProfile(currentProfile);
        }

    }, [settings, activeProfile]);


    const handleProfileSelect = (profileName: ProfileName) => {
        if (!settings || settings.USE_DYNAMIC_PROFILE_SELECTOR) return;
        const profileSettings = settingProfiles[profileName];
        setSettings({ ...settings, ...profileSettings });
        setActiveProfile(profileName);
    };

    const showMessage = (text: string, type: 'success' | 'error' = 'success', duration: number = 4000) => {
        setSaveMessage({ text, type });
        setTimeout(() => setSaveMessage(null), duration);
    };

    const handleChange = (id: keyof BotSettings, value: string | boolean | number) => {
        if (settings) {
            setSettings({ ...settings, [id]: value });
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        setIsSaving(true);
        try {
            await api.updateSettings(settings);
            setContextSettings(settings);
            incrementSettingsActivity();
            showMessage("Paramètres sauvegardés avec succès !");
        } catch (error: any) {
            showMessage(`Échec de la sauvegarde des paramètres : ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestBinanceConnection = async () => {
        if (!settings || !settings.BINANCE_API_KEY || !settings.BINANCE_SECRET_KEY) {
             showMessage("Veuillez entrer les clés API et secrète de Binance.", 'error');
            return;
        }
        setIsTestingBinance(true);
        try {
            const result = await api.testBinanceConnection(settings.BINANCE_API_KEY, settings.BINANCE_SECRET_KEY);
            showMessage(result.message, result.success ? 'success' : 'error');
        } catch (error: any) {
            showMessage(error.message || 'Le test de connexion à Binance a échoué.', 'error');
        } finally {
            setIsTestingBinance(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (!newPassword) {
            showMessage("Le mot de passe ne peut pas être vide.", 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage("Les mots de passe ne correspondent pas.", 'error');
            return;
        }
        setIsSaving(true);
        try {
            const result = await api.changePassword(newPassword);
            showMessage(result.message, result.success ? 'success' : 'error');
            if (result.success) {
                setNewPassword('');
                setConfirmPassword('');
            }
        } catch (error: any) {
            showMessage(error.message || "Échec de la mise à jour du mot de passe.", 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleClearAllData = async () => {
        setIsClearModalOpen(false); // Close the modal first
        setIsSaving(true);
        try {
            const result = await api.clearAllTradeData();
            if (result.success) {
                showMessage("Toutes les données de transaction ont été effacées avec succès !");
                refreshData(); // This will trigger a full data refresh across the app
            } else {
                 showMessage("Échec de l'effacement des données.", 'error');
            }
        } catch (error: any) {
             showMessage(error.message || "Une erreur est survenue lors de l'effacement des données.", 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const InputField: React.FC<{
        id: keyof BotSettings;
        label: string;
        type?: 'text' | 'number';
        step?: string;
        children?: React.ReactNode;
    }> = ({ id, label, type = 'number', step, children }) => {
        if (!settings) return null;
        return (
            <div>
                <label htmlFor={id} className="flex items-center text-sm font-medium text-gray-300">
                    {label}
                    <Tooltip text={tooltips[id]} />
                </label>
                <div className="relative mt-1">
                    <input
                        type={type}
                        id={id}
                        step={step}
                        value={settings[id] as any}
                        onChange={(e) => handleChange(id, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                        className={inputClass}
                    />
                    {children && <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">{children}</div>}
                </div>
            </div>
        );
    };

    const ToggleField: React.FC<{
        id: keyof BotSettings;
        label: string;
    }> = ({ id, label }) => {
        if (!settings) return null;
        return (
            <div className="flex justify-between items-center bg-[#0c0e12]/30 p-3 rounded-lg">
                <label htmlFor={id} className="flex items-center text-sm font-medium text-gray-300">
                    {label}
                    <Tooltip text={tooltips[id]} />
                </label>
                <ToggleSwitch
                    checked={settings[id] as boolean}
                    onChange={(checked) => handleChange(id, checked)}
                    leftLabel="ON"
                    rightLabel="OFF"
                />
            </div>
        );
    };

    if (!settings) {
        return <div className="flex justify-center items-center h-64"><Spinner /></div>;
    }

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center">
                <h2 className="text-3xl font-bold text-white">Paramètres</h2>
                <div className="relative">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center justify-center rounded-md border border-transparent bg-[#f0b90b] px-6 py-2 text-sm font-semibold text-black shadow-sm hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#0c0e12] disabled:opacity-50"
                    >
                         {isSaving ? <Spinner size="sm" /> : 'Sauvegarder les Changements'}
                    </button>
                    {saveMessage && (
                        <div className={`absolute top-full mt-2 right-0 text-xs px-3 py-1 rounded-md ${saveMessage.type === 'success' ? 'bg-green-800 text-green-200' : 'bg-red-800 text-red-200'}`}>
                           {saveMessage.text}
                        </div>
                    )}
                </div>
            </div>
            
             {/* Profile Selector */}
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-white mb-1">Profil de Comportement Adaptatif</h3>
                <p className="text-sm text-gray-400 mb-4">Activez le sélecteur dynamique pour laisser le bot choisir la meilleure tactique, ou désactivez-le pour sélectionner manuellement un profil.</p>
                <div className="flex items-center space-x-4 mb-4 bg-[#0c0e12]/30 p-3 rounded-lg">
                    <ToggleSwitch
                        checked={settings.USE_DYNAMIC_PROFILE_SELECTOR}
                        onChange={(checked) => handleChange('USE_DYNAMIC_PROFILE_SELECTOR', checked)}
                        leftLabel="AUTO"
                        rightLabel="MANUEL"
                    />
                    <label className="flex items-center text-sm font-medium text-gray-300">
                        Sélecteur de Profil Dynamique
                        <Tooltip text={tooltips.USE_DYNAMIC_PROFILE_SELECTOR} />
                    </label>
                </div>
                <div className={`transition-opacity ${settings.USE_DYNAMIC_PROFILE_SELECTOR ? 'opacity-50' : ''}`}>
                    <div className="isolate inline-flex rounded-md shadow-sm">
                        {(['Le Sniper', 'Le Scalpeur', 'Le Chasseur de Volatilité'] as ProfileName[]).map((profile, idx) => (
                            <button
                                key={profile}
                                type="button"
                                onClick={() => handleProfileSelect(profile)}
                                disabled={settings.USE_DYNAMIC_PROFILE_SELECTOR}
                                className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-[#3e4451] focus:z-10 transition-colors group
                                    ${activeProfile === profile && !settings.USE_DYNAMIC_PROFILE_SELECTOR ? 'bg-[#f0b90b] text-black' : 'bg-[#14181f] text-gray-300 hover:bg-[#2b2f38]'}
                                    ${idx === 0 ? 'rounded-l-md' : ''}
                                    ${idx === 2 ? 'rounded-r-md' : '-ml-px'}
                                    ${settings.USE_DYNAMIC_PROFILE_SELECTOR ? 'cursor-not-allowed' : ''}
                                `}
                            >
                                {profile}
                                <div className="absolute bottom-full mb-2 w-64 rounded-lg bg-gray-900 border border-gray-700 p-3 text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10 shadow-lg"
                                    style={{ transform: 'translateX(-50%)', left: '50%' }}>
                                    {profileTooltips[profile]}
                                    <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 bg-gray-900 border-b border-r border-gray-700" style={{ transform: 'translateX(-50%) rotate(45deg)' }}></div>
                                </div>
                            </button>
                        ))}
                    </div>
                    {activeProfile === 'PERSONNALISE' && !settings.USE_DYNAMIC_PROFILE_SELECTOR && <span className="ml-4 text-sm font-semibold text-sky-400">-- Profil Personnalisé Actif --</span>}
                    {settings.USE_DYNAMIC_PROFILE_SELECTOR && <span className="ml-4 text-sm font-semibold text-green-400">-- Le bot choisit la meilleure tactique --</span>}
                </div>
            </div>

            {/* Main Settings Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">

                {/* Left Column */}
                <div className="space-y-6">
                    {/* Trading Parameters */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Paramètres de Trading</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <InputField id="MAX_OPEN_POSITIONS" label="Positions Ouvertes Max" />
                             <InputField id="POSITION_SIZE_PCT" label="Taille de Position (%)" step="0.1" children={<span className="text-gray-400 text-sm">%</span>}/>
                             <InputField id="STOP_LOSS_PCT" label="Stop Loss (%)" step="0.1" children={<span className="text-gray-400 text-sm">%</span>}/>
                             <InputField id="RISK_REWARD_RATIO" label="Ratio Risque/Récompense" step="0.1" children={<span className="text-gray-400 text-sm">:1</span>}/>
                             <InputField id="INITIAL_VIRTUAL_BALANCE" label="Solde Virtuel Initial" step="100" children={<span className="text-gray-400 text-sm">$</span>}/>
                             <InputField id="SLIPPAGE_PCT" label="Slippage Simulé (%)" step="0.01" children={<span className="text-gray-400 text-sm">%</span>}/>
                        </div>
                    </div>
                    {/* Advanced Strategy */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Stratégie Avancée</h3>
                        <div className="space-y-4">
                            <ToggleField id="USE_MARKET_REGIME_FILTER" label="Filtre de Tendance Maître (4h)" />
                            <ToggleField id="USE_VOLUME_CONFIRMATION" label="Confirmation par Volume (1m)" />
                            <ToggleField id="USE_RSI_SAFETY_FILTER" label="Filtre de Sécurité RSI (1h)" />
                             <div className={`transition-opacity ${settings.USE_RSI_SAFETY_FILTER ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <InputField id="RSI_OVERBOUGHT_THRESHOLD" label="Seuil de Surchauffe RSI" />
                            </div>
                            <ToggleField id="REQUIRE_STRONG_BUY" label="Exiger un 'STRONG BUY' pour l'entrée" />
                            <InputField id="LOSS_COOLDOWN_HOURS" label="Cooldown après Perte (Heures)" children={<span className="text-gray-400 text-sm">h</span>}/>
                        </div>
                    </div>
                    
                     {/* Parabolic Filter */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Filtre Anti-Parabolique</h3>
                        <div className="space-y-4">
                             <ToggleField id="USE_PARABOLIC_FILTER" label="Activer le Filtre Anti-Mèches" />
                            <div className={`grid grid-cols-2 gap-4 transition-opacity ${settings.USE_PARABOLIC_FILTER ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                 <InputField id="PARABOLIC_FILTER_PERIOD_MINUTES" label="Période de Vérif. (min)" />
                                 <InputField id="PARABOLIC_FILTER_THRESHOLD_PCT" label="Seuil de Hausse (%)" step="0.1" />
                            </div>
                        </div>
                    </div>

                    {/* Dynamic Profile Thresholds */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Seuils du Profil Dynamique</h3>
                        <div className={`space-y-4 transition-opacity ${settings.USE_DYNAMIC_PROFILE_SELECTOR ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                             <InputField id="ADX_THRESHOLD_RANGE" label="Seuil ADX (Marché en Range)" />
                             <InputField id="ATR_PCT_THRESHOLD_VOLATILE" label="Seuil ATR % (Marché Volatil)" step="0.1" />
                        </div>
                    </div>

                    {/* Portfolio Intelligence */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Intelligence de Portefeuille</h3>
                        <div className="space-y-4">
                           <InputField id="SCALING_IN_CONFIG" label="Configuration des Entrées Fractionnées" type="text"/>
                           <hr className="border-gray-700"/>
                           <InputField id="MAX_CORRELATED_TRADES" label="Max Trades Corrélés Simultanés"/>
                        </div>
                    </div>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    {/* Market Scanner */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Scanner de Marché</h3>
                        <div className="grid grid-cols-1 gap-4">
                            <InputField id="MIN_VOLUME_USD" label="Volume 24h Minimum" step="1000000" children={<span className="text-gray-400 text-sm">$</span>}/>
                            <InputField id="SCANNER_DISCOVERY_INTERVAL_SECONDS" label="Intervalle de Scan (secondes)" children={<span className="text-gray-400 text-sm">s</span>}/>
                            <div>
                                <label htmlFor="EXCLUDED_PAIRS" className="flex items-center text-sm font-medium text-gray-300">
                                    Paires Exclues (séparées par des virgules)
                                    <Tooltip text={tooltips.EXCLUDED_PAIRS} />
                                </label>
                                <textarea
                                    id="EXCLUDED_PAIRS"
                                    value={settings.EXCLUDED_PAIRS}
                                    onChange={(e) => handleChange('EXCLUDED_PAIRS', e.target.value)}
                                    rows={2}
                                    className={inputClass + " font-mono"}
                                />
                            </div>
                        </div>
                    </div>
                    
                    {/* Entry Confirmation Filters */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Filtres de Confirmation d'Entrée</h3>
                        <div className="space-y-4">
                           <ToggleField id="USE_OBV_VALIDATION" label="Confirmation par Volume (OBV 1m)" />
                           <ToggleField id="USE_CVD_FILTER" label="Confirmation par Pression Nette (CVD 5m)" />
                           <ToggleField id="USE_MTF_VALIDATION" label="Validation Multi-Temporelle (5m)" />
                           <hr className="border-gray-700"/>
                           <ToggleField id="USE_OBV_5M_VALIDATION" label="Validation OBV Multi-Échelles (5m)" />
                           <hr className="border-gray-700"/>
                           <ToggleField id="USE_RSI_MTF_FILTER" label="Filtre RSI Multi-Temporel (15m)" />
                           <div className={`transition-opacity ${settings.USE_RSI_MTF_FILTER ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                               <InputField id="RSI_15M_OVERBOUGHT_THRESHOLD" label="Seuil RSI 15m" />
                           </div>
                           <hr className="border-gray-700"/>
                           <ToggleField id="USE_WICK_DETECTION_FILTER" label="Filtre de Mèches Anormales" />
                           <div className={`transition-opacity ${settings.USE_WICK_DETECTION_FILTER ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                               <InputField id="MAX_UPPER_WICK_PCT" label="Mèche Supérieure Max (%)" />
                           </div>
                        </div>
                    </div>

                    {/* Advanced Portfolio Filters */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Filtres de Portefeuille Avancés</h3>
                        <div className="space-y-4">
                            <ToggleField id="USE_ORDER_BOOK_LIQUIDITY_FILTER" label="Filtre de Liquidité (Carnet d'Ordres)" />
                            <div className={`transition-opacity ${settings.USE_ORDER_BOOK_LIQUIDITY_FILTER ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <InputField id="MIN_ORDER_BOOK_LIQUIDITY_USD" label="Liquidité Minimale Requise ($)" />
                            </div>
                            <hr className="border-gray-700"/>
                            <ToggleField id="USE_WHALE_MANIPULATION_FILTER" label="Filtre Anti-Manipulation (Baleine)" />
                             <div className={`transition-opacity ${settings.USE_WHALE_MANIPULATION_FILTER ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <InputField id="WHALE_SPIKE_THRESHOLD_PCT" label="Seuil Pic de Volume (%)" />
                            </div>
                            <hr className="border-gray-700"/>
                            <ToggleField id="USE_SECTOR_CORRELATION_FILTER" label="Filtre de Corrélation par Secteur" />
                        </div>
                    </div>

                    {/* Dynamic Risk Management */}
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-white mb-4">Gestion Dynamique du Risque</h3>
                        <div className="space-y-4">
                            <ToggleField id="USE_ATR_STOP_LOSS" label="Stop Loss basé sur l'ATR" />
                             <div className={`transition-opacity ${settings.USE_ATR_STOP_LOSS ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <InputField id="ATR_MULTIPLIER" label="Multiplicateur ATR" step="0.1" />
                            </div>
                            <hr className="border-gray-700"/>
                            <ToggleField id="USE_AUTO_BREAKEVEN" label="Mise à Zéro Automatique (Break-Even)" />
                             <div className={`pl-4 space-y-4 mt-2 transition-opacity ${settings.USE_AUTO_BREAKEVEN ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <InputField id="BREAKEVEN_TRIGGER_R" label="Déclencheur Break-Even (R)" step="0.1" />
                                <ToggleField id="ADJUST_BREAKEVEN_FOR_FEES" label="Ajuster pour les Frais" />
                                <div className={`transition-opacity ${settings.ADJUST_BREAKEVEN_FOR_FEES ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                    <InputField id="TRANSACTION_FEE_PCT" label="Frais de Transaction (%)" step="0.01" />
                                </div>
                            </div>
                            <hr className="border-gray-700"/>
                            <ToggleField id="USE_PARTIAL_TAKE_PROFIT" label="Prise de Profit Partielle" />
                             <div className={`grid grid-cols-2 gap-4 transition-opacity ${settings.USE_PARTIAL_TAKE_PROFIT ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                 <InputField id="PARTIAL_TP_TRIGGER_PCT" label="Déclencheur Partiel (%)" step="0.1" />
                                 <InputField id="PARTIAL_TP_SELL_QTY_PCT" label="Quantité à Vendre (%)" />
                            </div>
                            <hr className="border-gray-700"/>
                            <ToggleField id="USE_ADAPTIVE_TRAILING_STOP" label="Stop Loss Suiveur Adaptatif" />
                            <div className={`grid grid-cols-2 gap-4 transition-opacity ${settings.USE_ADAPTIVE_TRAILING_STOP ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <InputField id="TRAILING_STOP_TIGHTEN_THRESHOLD_R" label="Seuil de Resserrage (R)" step="0.1" />
                                <InputField id="TRAILING_STOP_TIGHTEN_MULTIPLIER_REDUCTION" label="Réduction du Multiplicateur" step="0.1" />
                            </div>
                             <hr className="border-gray-700"/>
                            <ToggleField id="USE_DYNAMIC_POSITION_SIZING" label="Dimensionnement Dynamique de Position" />
                            <div className={`transition-opacity ${settings.USE_DYNAMIC_POSITION_SIZING ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <InputField id="STRONG_BUY_POSITION_SIZE_PCT" label="Taille Position 'STRONG BUY' (%)" step="0.1" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* API and Security Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                     <h3 className="text-lg font-semibold text-white mb-4">Clés API</h3>
                     <div className="space-y-4">
                        <div>
                            <label htmlFor="BINANCE_API_KEY" className="flex items-center text-sm font-medium text-gray-300">
                                Clé API Binance <Tooltip text={tooltips.BINANCE_API_KEY} />
                            </label>
                             <input type="text" id="BINANCE_API_KEY" value={settings.BINANCE_API_KEY} onChange={(e) => handleChange('BINANCE_API_KEY', e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label htmlFor="BINANCE_SECRET_KEY" className="flex items-center text-sm font-medium text-gray-300">
                                Clé Secrète Binance <Tooltip text={tooltips.BINANCE_SECRET_KEY} />
                            </label>
                            <input type="password" id="BINANCE_SECRET_KEY" value={settings.BINANCE_SECRET_KEY} onChange={(e) => handleChange('BINANCE_SECRET_KEY', e.target.value)} className={inputClass} />
                        </div>
                         <button onClick={handleTestBinanceConnection} disabled={isTestingBinance} className="w-full text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50">
                             {isTestingBinance ? <Spinner size="sm" /> : 'Tester la Connexion Binance'}
                         </button>
                     </div>
                 </div>

                 <div className="space-y-6">
                    <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg p-6 shadow-lg">
                         <h3 className="text-lg font-semibold text-white mb-4">Sécurité & Disjoncteur Global</h3>
                         <div className="space-y-4">
                             <div className="grid grid-cols-2 gap-4">
                                <InputField id="CIRCUIT_BREAKER_WARN_THRESHOLD_PCT" label="Alerte Chute BTC (%)" step="0.1" />
                                <InputField id="CIRCUIT_BREAKER_HALT_THRESHOLD_PCT" label="Arrêt Chute BTC (%)" step="0.1" />
                                <InputField id="DAILY_DRAWDOWN_LIMIT_PCT" label="Limite Drawdown Journalier (%)" step="0.1" />
                                <InputField id="CONSECUTIVE_LOSS_LIMIT" label="Limite Pertes Consécutives" />
                             </div>
                             <hr className="border-gray-700 my-2"/>
                              <ToggleField id="USE_FEAR_AND_GREED_FILTER" label="Filtre Risk-Off (Fear & Greed)" />
                             <hr className="border-gray-700 my-2"/>
                             <div>
                                 <label htmlFor="newPassword" className="text-sm font-medium text-gray-300">Nouveau Mot de Passe</label>
                                 <input type="password" id="newPassword" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputClass} placeholder="Au moins 8 caractères"/>
                             </div>
                             <div>
                                 <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-300">Confirmer le Mot de Passe</label>
                                 <input type="password" id="confirmPassword" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputClass} />
                             </div>
                             <button onClick={handleUpdatePassword} disabled={isSaving} className="w-full text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-black bg-sky-400 hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:opacity-50">
                                 Mettre à Jour le Mot de Passe
                             </button>
                         </div>
                    </div>
                     <div className="bg-red-900/50 border border-red-700 rounded-lg p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-red-200 mb-2">Zone de Danger</h3>
                        <p className="text-sm text-red-300 mb-4">Cette action est irréversible. Elle effacera tout votre historique de transactions et réinitialisera votre solde virtuel.</p>
                        <button onClick={() => setIsClearModalOpen(true)} className="w-full text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
                           Effacer Toutes les Données de Transaction
                        </button>
                    </div>
                 </div>
            </div>
            
            <Modal
                isOpen={isClearModalOpen}
                onClose={() => setIsClearModalOpen(false)}
                onConfirm={handleClearAllData}
                title="Confirmer l'effacement des données ?"
                confirmText="Oui, tout effacer"
                confirmVariant="danger"
            >
                Êtes-vous absolument certain ? Toutes vos positions, votre historique de transactions et votre P&L seront définitivement supprimés. Votre solde sera réinitialisé.
            </Modal>
        </div>
    );
};

export default SettingsPage;