import useSpeechToText from './js/useSpeechToText';
import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from "react-markdown"
import rehypeRaw from 'rehype-raw'
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";
import Avatar from "@cloudscape-design/chat-components/avatar";
import LoadingBar from "@cloudscape-design/chat-components/loading-bar";
import LiveRegion from "@cloudscape-design/components/live-region";
import Box from "@cloudscape-design/components/box";
import {
  Container,
  Form,
  FormField,
  PromptInput,
  Button,
  Modal,
  SpaceBetween,
  TopNavigation,
  Input,
} from "@cloudscape-design/components";
import PropTypes from 'prop-types';



import * as Amplify from 'aws-amplify'
const { Auth } = Amplify;

import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";



/*
// IMPORTS robustos para aws-amplify (funciona con Vite)
import * as Amplify from 'aws-amplify';   // import "todo" como objeto
console.log('Amplify object present?', Boolean(Amplify));
*/

import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import './ChatComponent.css';



/**
 * Main chat interface component that handles message interaction with Bedrock agent
 * @param {Object} props - Component properties
 * @param {Object} props.user - Current authenticated user information
 * @param {Function} props.onLogout - Callback handler for logout action
 * @param {Function} props.onConfigEditorClick - Callback for configuration editor
 * @returns {JSX.Element} The chat interface
 */

// --------------------------------------------- [ENV CONFIGURATION] ---------------------------------------------


const ChatComponent = ({ user, onLogout, onConfigEditorClick }) => {
  // AWS Bedrock client instance for agent communication
  const [bedrockClient, setBedrockClient] = useState(null);
  // AWS Lambda client for Strands agent communication
  const [lambdaClient, setLambdaClient] = useState(null);
  // AgentCore client for AgentCore agent communication
  const [agentCoreClient, setAgentCoreClient] = useState(null);
  // Array of chat messages in the conversation
  const [messages, setMessages] = useState([]);
  // Current message being composed by the user
  const [newMessage, setNewMessage] = useState('');
  // Unique identifier for the current chat session
  const [sessionId, setSessionId] = useState(null);
  // Reference to automatically scroll to latest messages
  const messagesEndRef = useRef(null);
  // Tracks when the AI agent is processing a response
  const [isAgentResponding, setIsAgentResponding] = useState(false);
  // Controls visibility of the clear conversation modal
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  // Name of the AI agent for display purposes
  const [agentName, setAgentName] = useState({ value: 'Agent' });
  // Tracks completed tasks and their explanation
  const [tasksCompleted, setTasksCompleted] = useState({ count: 0, latestRationale: '' });
  // Flag to determine if using Strands Agent
  const [isStrandsAgent, setIsStrandsAgent] = useState(false);
  // Flag to determine if using AgentCore Agent
  const [isAgentCoreAgent, setIsAgentCoreAgent] = useState(false);



  const [chats, setChats] = useState([]);               // lista de chats del usuario
  const [selectedChat, setSelectedChat] = useState(null); // { chatId, chatName }
  const [loadingChats, setLoadingChats] = useState(false);


  /**
  * Scrolls the chat window to the most recent message
  * Uses smooth scrolling behavior for better user experience
  */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };


  // Estado para controlar el modal de nuevo chat
  const [showNewChatModal, setShowNewChatModal] = useState(false);

  // Estado para el nombre del chat
  const [chatName, setChatName] = useState("");

  // Estado para indicar si está cargando la creación del chat
  const [loadingNewChat, setLoadingNewChat] = useState(false);

  /**
 * Shows the modal for confirming conversation clearing
 */
  const handleClearData = () => {
    setShowClearDataModal(true);
  };

  /**
  Lines added for Speech to Text functionality
   */
  const { transcript, isListening, startListening, stopListening, speechRecognitionSupported } = useSpeechToText();
  console.log('Speech Recognition Supported', speechRecognitionSupported);
  useEffect(() => {
    if (transcript) {
      setNewMessage(transcript.trim());
      scrollToBottom();
    }
  }, [transcript]);


  /**
   * Handles the confirmation action for clearing conversation data
   */
  /**
   * Handles the confirmation action for clearing conversation data
   * Clears all local storage and reloads the application
   */
  const confirmClearData = () => {
    // Clear all stored data from localStorage
    localStorage.clear();
    // Reload the application to reset state
    window.location.reload();
  };

  /**
   * Creates a new chat session with a unique identifier
   * Clears existing messages and initializes storage for the new session
   * Uses timestamp as session identifier
   */
  const createNewSession = useCallback((providedSessionId) => {
    // Generate new session ID using current timestamp
    const newSessionId = providedSessionId 
    || `agentcore-session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
    // Update session state
    setSessionId(newSessionId);
    // Clear existing messages
    setMessages([]);
    // Store session information in localStorage
    localStorage.setItem('lastSessionId', newSessionId);
    localStorage.setItem(`messages_${newSessionId}`, JSON.stringify([]));
    console.log('New session created:', newSessionId);
  }, []);

  const API_URL = import.meta.env.VITE_CHAT_API_URL;

  const handleConfirmCreate = async () => {
    if (!chatName.trim()) return alert("Por favor ingresa un nombre para el chat.");

    try {
      setLoadingNewChat(true);

      let email = "desconocido";

      // Resolver el módulo Auth
      let AuthModule;
      try {
        AuthModule = await ensureAuthModule();
        console.log('AuthModule resolved:', AuthModule);
        console.log('AuthModule keys:', Object.keys(AuthModule || {}));
      } catch (authErr) {
        console.error('No se pudo resolver el módulo Auth:', authErr);
        return; // abortar si no hay Auth disponible
      }

      // 🟢 Obtener y mostrar el email del usuario autenticado
      try {
        const { getCurrentUser } = AuthModule;
        if (getCurrentUser) {
          const user = await getCurrentUser();
          email = user?.signInDetails?.loginId || user?.username || "desconocido";
          console.log("📧 Email del usuario autenticado:", email);
        } else {
          console.warn("getCurrentUser no está disponible en AuthModule.");
        }
      } catch (emailErr) {
        console.error("❌ Error obteniendo email del usuario:", emailErr);
      }


      // Obtener token de sesión actual
      let token;
      if (typeof AuthModule.currentSession === 'function') {
        const session = await AuthModule.currentSession();
        token = session?.getIdToken?.()?.getJwtToken?.() || null;
      } else if (typeof AuthModule.fetchAuthSession === 'function') {
        const session = await AuthModule.fetchAuthSession();
        token = session?.tokens?.idToken || null;
      }

      if (!token) {
        console.warn('No se pudo obtener token de sesión. La llamada a la API podría fallar.');
      }

      // Llamada a la API Gateway
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: token || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chatName, email }),
      });

      if (!response.ok) throw new Error("Error al crear el chat en la API");

      const data = await response.json();
      console.log("✅ Chat creado exitosamente:", data);


      // Retrieve data from lambda
      const newChatId = data.chatId;
      const createdAt = data.createdAt || new Date().toISOString();
      const newChatObj = {
        chatId: newChatId,
        chatName: chatName || data.chatName || "Chat sin nombre",
        createdAt,
      };

      // Actualizar estado de chats (poner el nuevo arriba) y seleccionarlo
      setChats(prev => [newChatObj, ...(prev || [])]);
      setSelectedChat(newChatObj);

      // Crear sesión local para este chat (limpia mensajes, marca lastSessionId)
      createNewSession(newChatId);
      // Aseguramos que sessionId quede sincronizado
      setSessionId(newChatId);
      // limpiamos modal y nombre
      setShowNewChatModal(false);
      setChatName("");

    } catch (error) {
      console.error("❌ Error al crear el chat:", error);
      alert("Hubo un problema creando el chat.");
    } finally {
      setLoadingNewChat(false);
    }
  };

  /**
   * Retrieves messages for a specific chat session from localStorage
   * @param {string} sessionId - The identifier of the session to fetch messages for
   * @returns {Array} Array of messages for the session, or empty array if none found
   */
  const fetchMessagesForSession = useCallback((sessionId) => {
    const storedMessages = localStorage.getItem(`messages_${sessionId}`);
    return storedMessages ? JSON.parse(storedMessages) : [];
  }, []);

  /**
   * Persists messages to localStorage for a specific session
   * Merges new messages with existing ones before storing
   * @param {string} sessionId - The identifier of the session to store messages for
   * @param {Array} newMessages - New messages to add to storage
   */
  const storeMessages = useCallback((sessionId, newMessages) => {
    // Retrieve existing messages for the session
    const currentMessages = fetchMessagesForSession(sessionId);
    // Merge existing and new messages
    const updatedMessages = [...currentMessages, ...newMessages];
    // Save updated message list to localStorage
    localStorage.setItem(`messages_${sessionId}`, JSON.stringify(updatedMessages));
  }, [fetchMessagesForSession]);

  /**
   * Attempts to load the last active chat session
   * Creates a new session if no existing session is found
   * Restores messages from localStorage for existing sessions
   */
  const loadExistingSession = useCallback(() => {
    // Try to get the ID of the last active session
    const lastSessionId = localStorage.getItem('lastSessionId');
    if (lastSessionId) {
      // If found, restore the session and its messages
      setSessionId(lastSessionId);
      const loadedMessages = fetchMessagesForSession(lastSessionId);
      setMessages(loadedMessages);
    } else {
      // If no existing session, create a new one
      createNewSession();
    }
  }, [createNewSession, fetchMessagesForSession]);




  // -------------------------------
  // Helper para resolver el módulo Auth (compatible v5 y v6)
  // -------------------------------
  const ensureAuthModule = async ({ timeout = 5000, interval = 200 } = {}) => {
    const start = Date.now();

    const wait = (ms) => new Promise((res) => setTimeout(res, ms));

    while (Date.now() - start < timeout) {
      try {
        // 1) Si declaraste `const { Auth } = Amplify;` y Auth ya está definido:
        if (typeof Auth !== 'undefined' && Auth && typeof Auth.currentCredentials === 'function') {
          return Auth; // objeto Auth estilo v5
        }

        // 2) Si importaste Amplify como namespace: import * as Amplify from 'aws-amplify'
        //    y Amplify.Auth está presente:
        if (typeof Amplify !== 'undefined' && Amplify && Amplify.Auth && typeof Amplify.Auth.currentCredentials === 'function') {
          return Amplify.Auth;
        }

        // 3) Intentar import dinámico (v6 modular): 'aws-amplify/auth'
        //    En v6 se exportan funciones como currentCredentials, signOut, etc.
        try {
          const authModule = await import('aws-amplify/auth');
          // Si el módulo tiene currentCredentials o signOut lo consideramos válido
          if (authModule && (typeof authModule.currentCredentials === 'function' || typeof authModule.signOut === 'function')) {
            return authModule;
          }
        } catch (e) {
          // ignore, seguiremos intentando fallbacks
        }

        // 4) Algunos bundles pueden exponer Amplify.default.Auth
        if (typeof Amplify !== 'undefined' && Amplify && Amplify.default && Amplify.default.Auth && typeof Amplify.default.Auth.currentCredentials === 'function') {
          return Amplify.default.Auth;
        }
      } catch (err) {
        // no detener el loop por errores temporales
        console.debug('ensureAuthModule check error (ignorando):', err);
      }

      // esperar un poco antes de reintentar
      await wait(interval);
    }

    // Timeout: no se encontró Auth
    throw new Error('Auth module no disponible: revisa tu import de aws-amplify / versión. Timeout alcanzado en ensureAuthModule.');
  };



  // -------------------------------
  // Initialize Amplify from appConfig (async, robusto)
  // -------------------------------
  const initializeAmplifyFromAppConfig = async (appConfig) => {
    try {
      if (localStorage.getItem('amplifyConfigured') === '1') {
        console.log('Amplify ya marcado como configurado (flag en localStorage).');
        return true;
      }

      const cognito = (appConfig && appConfig.cognito) || {};
      if (!cognito || !cognito.region || !cognito.userPoolId || !cognito.userPoolClientId) {
        console.warn('initializeAmplifyFromAppConfig: faltan campos Cognito en appConfig, no configurando Amplify aquí.');
        return false;
      }

      // Intentar llamar a configure de distintas formas (Amplify, Amplify.default, import dinámico)
      const cfg = {
        Auth: {
          region: cognito.region,
          userPoolId: cognito.userPoolId,
          userPoolWebClientId: cognito.userPoolClientId,
          identityPoolId: cognito.identityPoolId || undefined
        }
      };

      // 1) Amplify.configure si existe
      if (typeof Amplify !== 'undefined' && typeof Amplify.configure === 'function') {
        Amplify.configure(cfg);
        localStorage.setItem('amplifyConfigured', '1');
        console.log('Amplify configurado vía Amplify.configure()');
        return true;
      }

      // 2) Amplify.default.configure (algunos bundlers)
      if (typeof Amplify !== 'undefined' && Amplify && Amplify.default && typeof Amplify.default.configure === 'function') {
        Amplify.default.configure(cfg);
        localStorage.setItem('amplifyConfigured', '1');
        console.log('Amplify configurado vía Amplify.default.configure()');
        return true;
      }

      // 3) import dinámico de 'aws-amplify' y usar configure si está
      try {
        const mod = await import('aws-amplify');
        if (mod) {
          if (typeof mod.configure === 'function') {
            mod.configure(cfg);
            localStorage.setItem('amplifyConfigured', '1');
            console.log('Amplify configurado vía import("aws-amplify").configure()');
            return true;
          }
          if (mod.default && typeof mod.default.configure === 'function') {
            mod.default.configure(cfg);
            localStorage.setItem('amplifyConfigured', '1');
            console.log('Amplify configurado vía import("aws-amplify").default.configure()');
            return true;
          }
        }
      } catch (e) {
        console.debug('import("aws-amplify") no devolvió configure, intentando siguientes fallbacks...', e);
      }

      console.warn('No pude localizar una función configure en aws-amplify. Si usas Amplify v6 modular, configura Amplify en tu entrypoint (index.jsx) con las APIs modulares o instala la versión que exponga configure.');
      return false;
    } catch (err) {
      console.warn('initializeAmplifyFromAppConfig fallo:', err);
      return false;
    }
  };


  // -------------------------------
  // getAwsCredentials (mejorado, añade fetchAuthSession fallback y logs)
  // -------------------------------
  const getAwsCredentials = async (AuthModule, appConfig = {}) => {
    // 1) Intentar currentCredentials() si está disponible
    try {
      if (AuthModule && typeof AuthModule.currentCredentials === "function") {
        const credsResult = await AuthModule.currentCredentials();
        console.debug('getAwsCredentials: currentCredentials() result:', credsResult);
        const raw = credsResult?.credentials ? credsResult.credentials : credsResult;
        return {
          accessKeyId: raw?.accessKeyId || raw?.AccessKeyId || raw?.access_key_id,
          secretAccessKey: raw?.secretAccessKey || raw?.SecretAccessKey || raw?.secret_key,
          sessionToken: raw?.sessionToken || raw?.SessionToken || raw?.token || raw?.session_token
        };
      }
    } catch (e) {
      console.debug('currentCredentials() falló o no disponible:', e);
    }

    // Dentro de getAwsCredentials, reemplaza la sección que usa fetchAuthSession/Identity Pool
    try {
      const cognitoCfg = (appConfig && appConfig.cognito) || {};
      const identityPoolId = cognitoCfg.identityPoolId;
      const region = cognitoCfg.region;
      const userPoolId = cognitoCfg.userPoolId;

      if (!region) {
        throw new Error('Falta region en appConfig.cognito; no puedo continuar con Identity Pool / fetchAuthSession.');
      }

      // PRIMERO: intentar fetchAuthSession() y si ya trae "credentials" temporales, úsalos directamente.
      try {
        if (AuthModule && typeof AuthModule.fetchAuthSession === 'function') {
          const f = await AuthModule.fetchAuthSession();
          console.debug('getAwsCredentials: fetchAuthSession() =>', f);

          // Si fetchAuthSession ya trae credentials temporales, úsalas directamente
          if (f && f.credentials && f.credentials.accessKeyId && f.credentials.secretAccessKey) {
            console.log('getAwsCredentials: usando credentials devueltas por fetchAuthSession() (evitando Identity Pool).');
            return {
              accessKeyId: f.credentials.accessKeyId,
              secretAccessKey: f.credentials.secretAccessKey,
              sessionToken: f.credentials.sessionToken || f.credentials.sessionToken
            };
          }

          // Si no hay credentials, extraer idToken para Identity Pool
          if (f?.tokens?.idToken) {
            // idToken puede ser un objeto; extraer string de forma segura
            const tokenObj = f.tokens.idToken;
            let idTokenStr = null;
            if (typeof tokenObj === 'string') idTokenStr = tokenObj;
            else if (tokenObj?.jwtToken) idTokenStr = tokenObj.jwtToken;
            else if (typeof tokenObj.toString === 'function') idTokenStr = tokenObj.toString();
            if (idTokenStr) {
              // Asegurarnos de pasar una función que devuelva el token (forma segura para fromCognitoIdentityPool)
              const provider = fromCognitoIdentityPool({
                client: new CognitoIdentityClient({ region }),
                identityPoolId,
                logins: {
                  // pasar función que retorna el token string — evita tokenOrProvider not a function
                  [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: async () => idTokenStr
                }
              });
              const creds = await provider();
              console.debug('getAwsCredentials: credentials derivadas desde Identity Pool =>', creds);
              return {
                accessKeyId: creds.accessKeyId,
                secretAccessKey: creds.secretAccessKey,
                sessionToken: creds.sessionToken
              };
            }
          }
        }
      } catch (err) {
        console.debug('AuthModule.fetchAuthSession() falló o no devolvió creds útiles:', err);
      }

      // Si llegamos aquí y necesitamos seguir con el flujo habitual pero faltan datos:
      if (!identityPoolId || !userPoolId) {
        throw new Error('Faltan identityPoolId / userPoolId en appConfig.cognito; no se puede derivar credenciales via Identity Pool.');
      }
      // (el resto del flujo Identity Pool se mantiene más abajo si quieres mantenerlo)
    } catch (err) {
      console.debug('Derivación por Identity Pool (o fetchAuthSession) falló:', err);
    }


    // 3) último recurso: si Amplify.Auth estuvo disponible globalmente intenta su currentCredentials
    try {
      if (typeof Amplify !== 'undefined' && Amplify && Amplify.Auth && typeof Amplify.Auth.currentCredentials === 'function') {
        const rc = await Amplify.Auth.currentCredentials();
        console.debug('getAwsCredentials: fallback Amplify.Auth.currentCredentials() =>', rc);
        const raw = rc?.credentials ? rc.credentials : rc;
        return {
          accessKeyId: raw?.accessKeyId || raw?.AccessKeyId,
          secretAccessKey: raw?.secretAccessKey || raw?.SecretAccessKey,
          sessionToken: raw?.sessionToken || raw?.SessionToken
        };
      }
    } catch (err) {
      console.debug('Fallback Amplify.Auth.currentCredentials() falló:', err);
    }

    // Si llegamos aquí, falló todo
    throw new Error('No fue posible obtener credenciales AWS con los métodos disponibles.');
  };



  // ----- Helper para obtener token (reusa ensureAuthModule)
  const getAuthToken = async () => {
    try {
      const AuthModule = await ensureAuthModule();
      if (!AuthModule) return null;

      // Varias formas dependiendo de la versión de Amplify
      if (typeof AuthModule.currentSession === 'function') {
        const sess = await AuthModule.currentSession();
        return (sess?.getIdToken?.()?.getJwtToken?.()) || (sess?.idToken?.jwtToken) || null;
      } else if (typeof AuthModule.fetchAuthSession === 'function') {
        const s = await AuthModule.fetchAuthSession();
        return s?.tokens?.idToken || s?.idToken?.jwtToken || null;
      } else if (typeof AuthModule.currentAuthenticatedUser === 'function') {
        const cu = await AuthModule.currentAuthenticatedUser();
        return cu?.signInUserSession?.idToken?.jwtToken || cu?.idToken?.jwtToken || null;
      }
      return null;
    } catch (err) {
      console.debug('getAuthToken error:', err);
      return null;
    }
  };

  // ----- Obtener email del usuario (para fallback si tu GET /chats lo requiere)
  const getUserEmail = async () => {
    try {
      const AuthModule = await ensureAuthModule();
      if (!AuthModule) return null;
      if (typeof AuthModule.getCurrentUser === 'function') {
        const u = await AuthModule.getCurrentUser();
        return u?.signInDetails?.loginId || u?.username || u?.attributes?.email || null;
      } else if (typeof AuthModule.currentAuthenticatedUser === 'function') {
        const u = await AuthModule.currentAuthenticatedUser();
        // amplify v6 shapes vary
        return u?.username || u?.attributes?.email || null;
      }
      return null;
    } catch (e) {
      console.debug('getUserEmail error:', e);
      return null;
    }
  };



  // Normalizar base API para evitar duplicar rutas como "/chats/search/chats"
  const rawChatApi = import.meta.env.VITE_CHAT_API_URL || API_URL || '';
  // quitar un posible sufijo '/search/chats' o '/chats' si ya está presente
  const API_ROOT = rawChatApi.replace(/\/(?:search\/chats|chats)\/?$/i, '').replace(/\/$/,'');
  // Construir URL final de búsqueda (VITE_SEARCH_API_URL tiene prioridad si está definida)
  const SEARCH_API = import.meta.env.VITE_SEARCH_API_URL || `${API_ROOT}/search/chats`;


  // debounce helper
  const debounce = (fn, delay) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  };

  const fetchUserChats = async (query = '') => {
    setLoadingChats(true);
    try {
      const token = await getAuthToken().catch(()=>null);
      const email = await getUserEmail().catch(()=>null);
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (email) params.append('user', email);

      const url = `${SEARCH_API}?${params.toString()}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!resp.ok) {
        console.warn('search api not ok', resp.status);
        setChats([]);
        return;
      }

      const data = await resp.json();
      // suponer que data es array [{chatId, chatName, createdAt}]
      setChats(data.map(it => ({
        chatId: it.chatId,
        chatName: it.chatName,
        createdAt: it.createdAt
      })));
    } catch (err) {
      console.error('fetchUserChats(search) error:', err);
      setChats([]);
    } finally {
      setLoadingChats(false);
    }
  };

  // Debounced version para poner en search input
  const debouncedFetchUserChats = useCallback(debounce((q) => fetchUserChats(q), 350), []);


  // ----- fetchChatMessages: obtiene mensajes desde backend
  const fetchChatMessages = async (chatId) => {
    if (!chatId) return [];
    try {
      const token = await getAuthToken();
      const resp = await fetch(`${API_URL}/${chatId}/messages`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!resp.ok) {
        console.warn('fetchChatMessages: response not ok', resp.status);
        return [];
      }
      const data = await resp.json();
      // Si tu lambda devuelve Items (Dynamo) -> convertir a {text, sender}
      if (Array.isArray(data)) {
        return data.map(it => ({ text: it.message || it.text || '', sender: it.sender || 'agent' }));
      } else if (data.Items) {
        // ordenar por SK si quieres mantener orden cronológico (SK: MSG#timestamp#id)
        const items = data.Items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        return items.map(it => ({ text: it.message, sender: it.sender, createdAt: it.createdAt }));
      } else {
        return [];
      }
    } catch (err) {
      console.error('fetchChatMessages error:', err);
      return [];
    }
  };

  // ----- handleSelectChat: al click de un chat en la sidebar
  const handleSelectChat = async (chat) => {
    try {
      setSelectedChat(chat);
      setSessionId(chat.chatId);
      // load messages from server
      const msgs = await fetchChatMessages(chat.chatId);
      // Mensajes estarán en formato { text, sender }
      setMessages(msgs);
      // persistir en localStorage para experiencia offline / cache
      localStorage.setItem(`messages_${chat.chatId}`, JSON.stringify(msgs));
      localStorage.setItem('lastSessionId', chat.chatId);
      // scroll
      scrollToBottom();
    } catch (err) {
      console.error('handleSelectChat error:', err);
    }
  };

  // ----- useEffect: cargar lista de chats cuando user o API cambia o al crear un chat
  useEffect(() => {
    // si no hay user, salir
    if (!user) return;
    fetchUserChats();
  }, [user, sessionId]); // sessionId incluido para refrescar cuando creas nuevo chat


  

  
  // -------------------------------
  // useEffect(fetchCredentials) actualizado (espera initializeAmplifyFromAppConfig)
  // -------------------------------
  useEffect(() => {
    // Esperar al user (prop). Si no hay user, no intentar obtener credenciales.
    if (!user) {
      console.log('fetchCredentials: esperando prop user antes de intentar obtener credenciales.');
      return;
    }

    const fetchCredentials = async () => {
      try {
        // Resolver el módulo Auth
        let AuthModule;
        try {
          AuthModule = await ensureAuthModule();
          console.log('AuthModule resolved:', AuthModule);
          console.log('AuthModule keys:', Object.keys(AuthModule || {}));
        } catch (authErr) {
          console.error('No se pudo resolver el módulo Auth:', authErr);
          return; // abortar si no hay Auth disponible
        }

        // Cargar configuración app y, si es necesario, inicializar Amplify desde ella (fallback)
        let appConfig = {};
        try {
          appConfig = JSON.parse(localStorage.getItem('appConfig') || '{}');
        } catch (err) {
          console.warn('appConfig en localStorage no es JSON válido, usando {}', err);
          appConfig = {};
        }

        // Intentar configurar Amplify (async) si no fue configurado
        try {
          const ok = await initializeAmplifyFromAppConfig(appConfig);
          console.log('initializeAmplifyFromAppConfig result:', ok);
        } catch (err) {
          console.warn('initializeAmplifyFromAppConfig threw:', err);
        }

        const bedrockConfig = appConfig.bedrock || {};
        const strandsConfig = appConfig.strands || {};
        const agentCoreConfig = appConfig.agentcore || {};

        setIsStrandsAgent(Boolean(strandsConfig.enabled));
        setIsAgentCoreAgent(Boolean(agentCoreConfig.enabled));

        console.log('appConfig (from localStorage):', appConfig);
        console.log('user prop:', user);

        // Obtener credenciales (usa la función robusta que intenta varios métodos)
        let awsCreds;
        try {
          awsCreds = await getAwsCredentials(AuthModule, appConfig);
        } catch (credErr) {
          console.error('No se pudieron obtener credenciales AWS:', credErr);
          return;
        }

        // Normalizar campos de credenciales
        const creds = {
          accessKeyId: awsCreds.accessKeyId,
          secretAccessKey: awsCreds.secretAccessKey,
          sessionToken: awsCreds.sessionToken
        };

        if (!creds.accessKeyId || !creds.secretAccessKey) {
          console.error('Credenciales AWS incompletas o inválidas:', creds);
          return;
        }

        // Inicializar Bedrock client (si aplica)
        if (!strandsConfig.enabled && !agentCoreConfig.enabled && bedrockConfig.region) {
          const newBedrockClient = new BedrockAgentRuntimeClient({
            region: bedrockConfig.region,
            credentials: creds
          });
          setBedrockClient(newBedrockClient);
          if (bedrockConfig.agentName) setAgentName({ value: bedrockConfig.agentName });
          console.log('Bedrock client inicializado en región', bedrockConfig.region);
        }

        // Lambda client (Strands)
        if (strandsConfig.enabled && strandsConfig.region && strandsConfig.lambdaArn) {
          const newLambdaClient = new LambdaClient({
            region: strandsConfig.region,
            credentials: creds
          });
          setLambdaClient(newLambdaClient);
          if (strandsConfig.agentName) setAgentName({ value: strandsConfig.agentName });
          console.log('Lambda client (Strands) inicializado en región', strandsConfig.region);
        }

        // AgentCore client
        if (agentCoreConfig.enabled && agentCoreConfig.region && agentCoreConfig.agentArn) {
          const newAgentCoreClient = new BedrockAgentCoreClient({
            region: agentCoreConfig.region,
            credentials: creds
          });
          setAgentCoreClient(newAgentCoreClient);
          if (agentCoreConfig.agentName) setAgentName({ value: agentCoreConfig.agentName });
          console.log('AgentCore client inicializado en región', agentCoreConfig.region);
        }

      } catch (error) {
        console.error('Error fetching credentials:', error);
      }
    };

    fetchCredentials();
    // Re-ejecutar si cambia user (login/logout)
  }, [user]);





  useEffect(() => {
    if ((bedrockClient || lambdaClient || agentCoreClient) && !sessionId) {
      loadExistingSession();
    }
  }, [bedrockClient, lambdaClient, agentCoreClient, sessionId, loadExistingSession]);

  /**
   * Effect hook to scroll to latest messages
   * Triggered whenever messages array is updated
   */
  useEffect(() => {
    scrollToBottom();
  }, [messages]);


  // Helper storeMessage:
  const storeMessage = async ({ chatId, message, sender }) => {
    if (!chatId) throw new Error("chatId es requerido para guardar el mensaje");

    try {
      // Obtener token de Cognito
      const AuthModule = await ensureAuthModule();
      let token = null;
      if (AuthModule) {
        const session = await (AuthModule.currentSession?.() || AuthModule.fetchAuthSession?.());
        token = session?.getIdToken?.()?.getJwtToken?.() || session?.idToken?.jwtToken || null;
      }

      // Endpoint dinámico (Mover a env)
      const resp = await fetch(`${API_URL}/${chatId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ message, sender }),
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Error guardando mensaje: ${resp.status} ${txt}`);
      }

      const data = await resp.json();
      console.log("✅ Mensaje guardado:", data);
      return data;

    } catch (err) {
      console.error("❌ Error guardando mensaje:", err);
    }
  };


  /**
   * Handles the submission of new messages to the chat
   * Sends message to Bedrock agent or Strands agent and processes response
   * @param {Event} e - Form submission event
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newMessage?.trim() || !sessionId) return;
  
    // lee appConfig una sola vez aquí
    const appConfig = JSON.parse(localStorage.getItem('appConfig') || '{}');
  
    // Helper para mostrar credenciales de forma segura (mask)
    const mask = (s = '') => {
      if (!s) return '(empty)';
      const str = String(s);
      if (str.length <= 8) return `${str.slice(0, 2)}...${str.slice(-2)}`;
      return `${str.slice(0, 4)}...${str.slice(-4)}`;
    };
  
    // Helper interno: envia mensaje al API Gateway del agente (hardcode endpoint)
    const sendToAgentEndpoint = async ({ sessionId, message }) => {
      const endpoint = 'https://fsrf981nu0.execute-api.us-east-1.amazonaws.com/production/chat';
      const headers = { 'Content-Type': 'application/json' };
  
      // Intento de extraer un idToken de Cognito/Amplify para Authorization Bearer (opcional)
      try {
        const AuthModule = await ensureAuthModule().catch(() => null);
        if (AuthModule) {
          let token = null;
          try {
            if (typeof AuthModule.currentSession === 'function') {
              const sess = await AuthModule.currentSession();
              token =
                (sess?.getIdToken && typeof sess.getIdToken === 'function' && sess.getIdToken().getJwtToken && sess.getIdToken().getJwtToken()) ||
                sess?.idToken?.jwtToken ||
                (sess?.tokens && sess.tokens.idToken);
            } else if (typeof AuthModule.fetchAuthSession === 'function') {
              const f = await AuthModule.fetchAuthSession();
              token = f?.tokens?.idToken || f?.idToken?.jwtToken || f?.idToken;
            } else if (AuthModule?.currentAuthenticatedUser) {
              try {
                const cu = await AuthModule.currentAuthenticatedUser();
                token = cu?.signInUserSession?.idToken?.jwtToken || cu?.idToken?.jwtToken;
              } catch (e) { /* ignore */ }
            }
          } catch (err) {
            console.debug('No se pudo extraer idToken del AuthModule:', err);
          }
  
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            console.debug('sendToAgentEndpoint: Authorization header added (masked).');
          }
        }
      } catch (err) {
        console.debug('sendToAgentEndpoint: ensureAuthModule falló (no Authorization).', err);
      }
  
      const body = {
        sessionId,
        message,
        user: user?.username || 'anonymous'
      };
  
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
  
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Agent API error ${resp.status}: ${txt}`);
      }
  
      let data = null;
      try {
        data = await resp.json();
      } catch (err) {
        console.warn('sendToAgentEndpoint: respuesta no es JSON, devolviendo texto crudo.', err);
        const txt = await resp.text().catch(() => '');
        return txt || '';
      }
  
      const reply = data?.reply || data?.response || data?.text || data?.message || (typeof data === 'string' ? data : JSON.stringify(data));
      return reply;
    };
  
    // Helper para procesar completion stream de Bedrock (similar al ejemplo)
    const processCompletion = async (response) => {
      if (response?.completion === undefined) throw new Error("Completion is undefined");
      let text = "";
      for await (const chunkEvent of response.completion) {
        try {
          console.debug('chunkEvent (raw):', chunkEvent);
          if (chunkEvent.trace && chunkEvent.trace.trace && chunkEvent.trace.trace.failureTrace) {
            console.error('Agent returned failureTrace:', chunkEvent.trace.trace.failureTrace);
          }
        } catch (logErr) {
          console.debug('Error logging chunkEvent', logErr);
        }
  
        if (chunkEvent.trace) {
          // Mantener trazas/acciones
          tasksCompleted.count++;
          if (chunkEvent.trace.trace?.failureTrace) {
            console.error('FailureTrace detected; throwing with reason:', chunkEvent.trace.trace.failureTrace.failureReason);
            throw new Error(chunkEvent.trace.trace.failureTrace.failureReason);
          }
          if (chunkEvent.trace.trace?.orchestrationTrace?.rationale) {
            tasksCompleted.latestRationale = chunkEvent.trace.trace.orchestrationTrace.rationale.text;
            try { scrollToBottom(); } catch (e) { /* ignore */ }
          }
          setTasksCompleted({ ...tasksCompleted });
        } else if (chunkEvent.chunk) {
          text += new TextDecoder("utf-8").decode(chunkEvent.chunk.bytes);
        }
      }
      return text;
    };
  
    // Clear input field (UX)
    const originalMessage = newMessage;
    setNewMessage('');
  
    // obtener id consistente del usuario (preferimos el email que guardamos en userIdForMessages)
    let senderId = userIdForMessages;
    if (!senderId) {
      try { senderId = await getUserEmail() || user?.username; } catch (e) { senderId = user?.username; }
    }
  
    const userMessage = { text: originalMessage, sender: senderId || user?.username || 'anonymous' };
    setMessages(prev => [...prev, userMessage]);
    setIsAgentResponding(true);
  
    try {
      console.groupCollapsed('handleSubmit -> attempt Bedrock then fallback endpoint');
      console.log('sessionId:', sessionId);
      console.log('user:', user?.username);
      console.log('message preview:', originalMessage.slice(0, 200));
      console.log('appConfig (loaded):', appConfig);
  
      // Intento BEDROCK primero (si hay cliente bedrock disponible)
      let agentReplyText = null;
      let usedFallback = false;
  
      const bedrockConfig = (appConfig && appConfig.bedrock) || {};
      const configAgentId = bedrockConfig.agentId ? String(bedrockConfig.agentId).trim() : undefined;
      const configAliasId = bedrockConfig.agentAliasId ? String(bedrockConfig.agentAliasId).trim() : undefined;
      const configRegion = bedrockConfig.region ? String(bedrockConfig.region).trim() : undefined;
  
      console.log('bedrockConfig:', { agentId: configAgentId, agentAliasId: configAliasId, region: configRegion });
  
      if (typeof bedrockClient !== 'undefined' && bedrockClient && !isStrandsAgent) {
        try {
          // Obtener credenciales AWS si es necesario para logging (no se mandan en body)
          const AuthModule = await ensureAuthModule().catch(() => null);
          let awsCreds;
          try {
            awsCreds = await getAwsCredentials(AuthModule, appConfig);
          } catch (credErr) {
            console.warn('getAwsCredentials falló (continuando de todas formas):', credErr);
          }
  
          if (awsCreds) {
            console.log('AWS credentials (masked):', {
              accessKeyId: mask(awsCreds?.accessKeyId),
              secretAccessKey: mask(awsCreds?.secretAccessKey),
              sessionToken: mask(awsCreds?.sessionToken)
            });
          }
  
          // Construir parámetros base
          const baseParams = {
            agentId: configAgentId,
            sessionId: sessionId,
            endSession: false,
            enableTrace: true,
            inputText: originalMessage
          };
  
          console.log('InvokeAgent baseParams (sanitized):', {
            agentId: baseParams.agentId,
            hasSessionId: Boolean(baseParams.sessionId),
            endSession: baseParams.endSession,
            enableTrace: baseParams.enableTrace,
            inputTextPreview: baseParams.inputText.slice(0, 200)
          });
  
          // Intentar con alias si existe; si falla con ResourceNotFound -> reintentar sin alias
          let response;
          if (configAliasId) {
            try {
              const paramsWithAlias = { ...baseParams, agentAliasId: configAliasId };
              console.log('Attempting InvokeAgent with aliasId:', configAliasId);
              const command = new InvokeAgentCommand(paramsWithAlias);
              response = await bedrockClient.send(command);
            } catch (err) {
              console.error('InvokeAgent with alias failed:', { name: err?.name, message: err?.message, $metadata: err?.$metadata });
              if (err && err.name === 'ResourceNotFoundException') {
                console.warn('Alias no encontrado; reintentando solo con agentId...');
                const command = new InvokeAgentCommand(baseParams); // sin agentAliasId
                response = await bedrockClient.send(command);
              } else {
                // Propagar para que el catch exterior pueda hacer fallback
                throw err;
              }
            }
          } else {
            // No hay alias => invocar directamente con agentId
            const command = new InvokeAgentCommand(baseParams);
            response = await bedrockClient.send(command);
          }
  
          console.log('InvokeAgent response metadata:', {
            $metadata: response?.$metadata ? { httpStatusCode: response.$metadata.httpStatusCode, requestId: response.$metadata.requestId } : undefined
          });
  
          // procesar streaming completion
          const completionText = await processCompletion(response);
          console.log('completionText (preview):', completionText.slice(0, 500));
          agentReplyText = completionText;
        } catch (bedrockErr) {
          console.error('Bedrock invocation failed, will fallback to endpoint:', {
            name: bedrockErr?.name,
            message: bedrockErr?.message,
            $metadata: bedrockErr?.$metadata
          });
          usedFallback = true;
        }
      } else {
        console.log('No bedrockClient available or isStrandsAgent === true: skipping Bedrock attempt.');
        usedFallback = true;
      }
  
      // Si bedrock falló o no estaba disponible, usar endpoint fallback
      if (usedFallback || agentReplyText === null) {
        console.groupCollapsed('FALLBACK -> invoking external agent HTTP endpoint');
        try {
          const replyText = await sendToAgentEndpoint({ sessionId, message: originalMessage });
          console.log('fallback endpoint reply (preview):', (typeof replyText === 'string' ? replyText.slice(0, 500) : JSON.stringify(replyText).slice(0, 500)));
          agentReplyText = replyText;
        } catch (endpointErr) {
          console.error('Fallback endpoint also failed:', {
            name: endpointErr?.name,
            message: endpointErr?.message,
            stack: endpointErr?.stack
          });
          throw endpointErr; // será capturado por el catch global abajo
        } finally {
          console.groupEnd();
        }
        console.groupEnd();
      }
  
      // Build agent message and persist both messages
      const agentMessage = { text: agentReplyText, sender: agentName?.value || 'Agent' };
  
      // 🟢 Obtener y mostrar el email del usuario autenticado (opcional, no abortar si falla)
      try {
        const AuthModuleForEmail = await ensureAuthModule().catch(() => null);
        if (AuthModuleForEmail && AuthModuleForEmail.getCurrentUser) {
          try {
            const currentUser = await AuthModuleForEmail.getCurrentUser();
            console.log('Authenticated user (for debug):', currentUser?.signInDetails?.loginId || currentUser?.username || 'desconocido');
          } catch (emailErr) {
            console.warn('No se pudo obtener getCurrentUser:', emailErr);
          }
        }
      } catch (e) {
        console.debug('No se pudo acceder a AuthModule para email (continuando):', e);
      }
  
      // Guardar mensajes (usuario + agente)
      try {
        await storeMessage({ chatId: sessionId, message: originalMessage, sender: senderId });
      } catch (smErr) {
        console.warn('storeMessage (user) falló (continuando):', smErr);
      }
      try {
        await storeMessage({ chatId: sessionId, message: agentReplyText, sender: agentName?.value || 'Agent' });
      } catch (smErr2) {
        console.warn('storeMessage (agent) falló (continuando):', smErr2);
      }
  
      // Append agent message to UI and persist locally
      setMessages(prev => [...prev, agentMessage]);
      try { storeMessages(sessionId, [userMessage, agentMessage]); } catch (sme) { console.warn('storeMessages failed:', sme); }
  
      console.groupEnd();
    } catch (err) {
      console.error('Error invoking agent (final catch):', {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
        $metadata: err?.$metadata
      });
      const errReason = "**" + String(err) + "**";
      const errorMessage = { text: `An error occurred while processing your request:\n${errReason}`, sender: 'agent' };
      setMessages(prev => [...prev, errorMessage]);
      try { storeMessages(sessionId, [userMessage, errorMessage]); } catch (sme) { /* ignore */ }
    } finally {
      setIsAgentResponding(false);
      setTasksCompleted({ count: 0, latestRationale: '' });
    }
  };
  
  


  const handleLogout = async () => {
    try {
      try {
        const AuthModule = await ensureAuthModule();
        if (AuthModule && typeof AuthModule.signOut === 'function') {
          await AuthModule.signOut();
        } else if (Amplify && Amplify.Auth && typeof Amplify.Auth.signOut === 'function') {
          await Amplify.Auth.signOut();
        } else {
          console.warn('signOut no disponible en el módulo Auth');
        }
      } catch (err) {
        console.error('Error durante logout (no se resolvió Auth):', err);
      }
      onLogout();
    } catch (error) {
      console.error('Error signing out: ', error);
    }
  };



  // Identificador estable para comparar remitentes (preferimos email si está disponible)
  const [userIdForMessages, setUserIdForMessages] = useState(user?.username || null);

  // Cuando cambie `user`, intentar resolver email y guardarlo en userIdForMessages
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const email = await getUserEmail(); // tu helper ya definido en el componente
        if (mounted) setUserIdForMessages(email || user?.username || null);
      } catch (e) {
        if (mounted) setUserIdForMessages(user?.username || null);
      }
    })();
    return () => { mounted = false; };
  }, [user]);



  // --- Formateo de fechas al huso horario del usuario ---
  const userTimeZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : undefined;

  const formatToUserTZ = (isoString) => {
    if (!isoString) return '';
    try {
      // Si el string es un ISO sin zona (ej. "2025-11-04T17:41:29.329622")
      // añadimos 'Z' para forzar que JS lo trate como UTC.
      const isoNoZoneRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
      let normalized = isoString;
      if (isoNoZoneRegex.test(isoString.trim())) {
        normalized = isoString.trim() + 'Z';
      }
      const d = new Date(normalized); // ahora interpretará correctamente como UTC si viene con Z o +00:00

      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: userTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      return fmt.format(d).replace(',', '');
    } catch (e) {
      // fallback manual
      const d = new Date(isoString);
      const pad = (n) => String(n).padStart(2, '0');
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const yyyy = d.getFullYear();
      const hh = pad(d.getHours());
      const min = pad(d.getMinutes());
      return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
    }
  };


  // Control menú de opciones por chat (chatId o null)
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editChatId, setEditChatId] = useState(null);
  const [editChatName, setEditChatName] = useState('');

  // Toggle menú
  const toggleMenu = (chatId) => {
    setMenuOpenFor((prev) => (prev === chatId ? null : chatId));
  };

  // Abrir modal edición
  const openEditModal = (chat) => {
    setEditChatId(chat.chatId);
    setEditChatName(chat.chatName || '');
    setEditModalOpen(true);
    setMenuOpenFor(null);
  };

  // Confirmar edición (actualiza local y opcionalmente backend)
  const confirmEditChat = async () => {
    if (!editChatId) return;
    const newName = (editChatName || '').trim();
    if (!newName) { alert('El nombre no puede estar vacío.'); return; }
  
    // Actualizar localmente (UX inmediata)
    setChats(prev => prev.map(c => c.chatId === editChatId ? { ...c, chatName: newName } : c));
    if (selectedChat?.chatId === editChatId) {
      setSelectedChat(prev => prev ? ({ ...prev, chatName: newName }) : prev);
    }
  
    // Obtener email del usuario para poder localizar el item en Dynamo
    let email = null;
    try {
      if (typeof getUserEmail === 'function') {
        email = await getUserEmail();
      }
    } catch (e) {
      console.warn('No se pudo obtener email del usuario para la actualización:', e);
    }
  
    // Enviar al backend: incluir email si lo tienes
    try {
      const token = await getAuthToken().catch(() => null);
      const body = { chatName: newName, ...(email ? { email } : {}) };
  
      const resp = await fetch(`${API_URL}/${editChatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body),
      });
  
      if (!resp.ok) {
        // Si falla, opcionalmente reintentar o avisar
        console.warn('Rename request failed', resp.status);
      } else {
        // Si backend devuelve el item actualizado, podrías actualizar localmente con lo que responda:
        try {
          const data = await resp.json().catch(() => null);
          if (data && data.chatName) {
            setChats(prev => prev.map(c => c.chatId === editChatId ? ({ ...c, chatName: data.chatName }) : c));
          }
        } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.debug('PUT rename error:', err);
    }
  
    setEditModalOpen(false);
    setEditChatId(null);
    setEditChatName('');
  };
  


  // modal + control de borrado
  const [showDeleteChatModal, setShowDeleteChatModal] = useState(false);
  const [chatToDelete, setChatToDelete] = useState(null);     // objeto chat seleccionado para borrar
  const [deletingChatId, setDeletingChatId] = useState(null); // chatId que actualmente se está borrando (para loading)

  // cuando el usuario pulsa "Delete" en el menú: abre el modal de confirmación
  const handleDeleteChat = (chat) => {
    // cerrar cualquier menú abierto
    setMenuOpenFor(null);

    // abrir modal y almacenar referencia al chat a borrar
    setChatToDelete(chat);
    setShowDeleteChatModal(true);
  };

  const confirmDeleteChat = async () => {
    if (!chatToDelete) return;
  
    const chatId = chatToDelete.chatId;
    setDeletingChatId(chatId);
  
    // marcar optimista (opcional)
    setChats(prev => prev.map(c => c.chatId === chatId ? ({ ...c, deleting: true }) : c));
  
    try {
      const token = await getAuthToken().catch(() => null);
  
      const resp = await fetch(`${API_URL}/${chatId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
  
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Server returned ${resp.status} ${body}`);
      }
  
      // BORRADO OK: actualizar UI local
      setChats(prev => prev.filter(x => x.chatId !== chatId));
      localStorage.removeItem(`messages_${chatId}`);
  
      if (selectedChat?.chatId === chatId) {
        setSelectedChat(null);
        setSessionId(null);
        setMessages([]);
      }
  
      // cerrar modal y limpiar estados
      setShowDeleteChatModal(false);
      setChatToDelete(null);
      setDeletingChatId(null);
  
    } catch (err) {
      console.error('DELETE chat error:', err);
      // revertir marca de deleting
      setChats(prev => prev.map(c => c.chatId === chatId ? ({ ...c, deleting: false }) : c));
      setDeletingChatId(null);
      alert('No se pudo eliminar el chat en el servidor. Revisa la consola para más detalle.');
    }
  };

  const cancelDeleteChat = () => {
    setShowDeleteChatModal(false);
    setChatToDelete(null);
  };
  



  // Cerrar menú cuando se cambia de chat
  useEffect(() => {
    setMenuOpenFor(null);
  }, [selectedChat?.chatId]);

  useEffect(() => {
    if (!menuOpenFor) return;
    const onDocClick = () => setMenuOpenFor(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpenFor]);
  

  // dentro de ChatComponent (arriba del return)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const settingsRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    function handleDocClick(e) {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);


  return (() => {
    // calcular índice de la última respuesta enviada por el agente (sender distinto a user.username)
    const lastAgentIndex = messages.reduce((acc, m, i) => (m.sender !== user.username ? i : acc), -1);
  
    return (
      <div className="chat-component">
        <div className="container-stretch">
          <div className="chat-container two-column">
  
            {/* ---------------------- SIDEBAR - Lista de chats ---------------------- */}
            <aside className="chat-sidebar" aria-label="Lista de chats">
              {/* Sidebar vertical: Nuevo arriba y luego buscador */}
              <div className="sidebar-nav" role="toolbar" aria-label="Sidebar navigation">
                <button
                  type="button"
                  className="new-chat-btn"
                  onClick={() => setShowNewChatModal(true)}
                  title="Nuevo chat"
                  aria-label="Crear nuevo chat"
                >
                  New Chat
                </button>
  
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input
                    type="search"
                    className="chat-search"
                    placeholder="Search chats..."
                    onChange={(e) => {
                      const q = e.target.value;
                      setSearchQuery(q);
                      debouncedFetchUserChats(q);
                    }}
                    aria-label="Search chats"
                  />
                </div>
              </div>
  
              {/* Lista con scroll */}
              <div className="sidebar-list" role="list">
                {loadingChats && <div className="sidebar-empty">Loading...</div>}
  
                {!loadingChats && chats.length === 0 && (
                  <div className="sidebar-empty">
                    No tienes chats aún. Crea uno nuevo con «Nuevo».
                  </div>
                )}
  
                {!loadingChats && chats.filter(c => c._visible !== false).map((c) => (
                <div
                  key={c.chatId}
                  className={`sidebar-item ${selectedChat?.chatId === c.chatId ? 'selected' : ''}`}
                  onClick={() => handleSelectChat(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSelectChat(c); }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedChat?.chatId === c.chatId}
                >
                  <div className="sidebar-item-main">
                    <div className="chat-name">{c.chatName || 'Chat sin nombre'}</div>
                    <div className="chat-meta">{c.createdAt ? formatToUserTZ(c.createdAt) : ''}</div>
                  </div>

                  {/* three-dot actions (abre menu contextual) */}
                  <button
                    className="chat-more-btn"
                    title="Más opciones"
                    aria-label={`Más opciones de ${c.chatName || 'chat'}`}
                    onClick={(e) => {
                      e.stopPropagation();            // evitar seleccionar el chat
                      toggleMenu(c.chatId);
                    }}
                  >
                    ⋯
                  </button>

                  {/* Menú contextual */}
                  {menuOpenFor === c.chatId && (
                    <div
                      className="chat-options-menu"
                      role="menu"
                      aria-label={`Opciones de ${c.chatName || 'chat'}`}
                      onClick={(e) => e.stopPropagation()} // impedir cerrar por el listener global
                    >
                      <button
                        className="menu-item"
                        role="menuitem"
                        onClick={() => openEditModal(c)}
                      >
                        ✎ Edit name
                      </button>
                      <button
                        className="menu-item"
                        role="menuitem"
                        onClick={() => handleDeleteChat(c)}
                      >
                        🗑 Delete chat
                      </button>
                    </div>
                  )}
                </div>
              ))}
              </div>
            </aside>
  
            {/* ---------------------- MAIN - Chat UI existente ---------------------- */}
            <main className="chat-main">
              {/* Top navigation - custom (usa solo divs) */}
              <div className="topnav-wrapper">
                <div className="custom-topnav" role="navigation" aria-label="Top navigation">
                  <div className="identity" aria-hidden={false}>
                    <div className="identity-title">Chat with Nova Micro</div>
                  </div>

                  <div className="utilities" aria-hidden={false}>
                    {/* Settings dropdown */}
                    <div className="utility" ref={settingsRef}>
                      <button
                        type="button"
                        className="utility-btn"
                        aria-haspopup="true"
                        aria-expanded={settingsOpen}
                        aria-label="Settings"
                        onClick={() => setSettingsOpen((s) => !s)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                          <path d="M19.14 12.936a7.952 7.952 0 0 0 0-1.872l2.037-1.58a.5.5 0 0 0 .12-.638l-1.928-3.338a.5.5 0 0 0-.607-.22l-2.397.96a7.963 7.963 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 14.9 2h-3.8a.5.5 0 0 0-.495.428l-.36 2.54a7.963 7.963 0 0 0-1.62.94l-2.397-.96a.5.5 0 0 0-.607.22L2.693 8.845a.5.5 0 0 0 .12.638l2.037 1.58a7.952 7.952 0 0 0 0 1.872l-2.037 1.58a.5.5 0 0 0-.12.638l1.928 3.338a.5.5 0 0 0 .607.22l2.397-.96a7.963 7.963 0 0 0 1.62.94l.36 2.54A.5.5 0 0 0 11.1 22h3.8a.5.5 0 0 0 .495-.428l.36-2.54a7.963 7.963 0 0 0 1.62-.94l2.397.96a.5.5 0 0 0 .607-.22l1.928-3.338a.5.5 0 0 0-.12-.638l-2.037-1.58zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>
                        </svg>
                      </button>


                      {settingsOpen && (
                        <div className="dropdown-menu" role="menu" aria-label="Settings menu">
                          <button
                            type="button"
                            className="menu-item"
                            role="menuitem"
                            onClick={() => { setSettingsOpen(false); handleClearData(); }}
                          >
                            {/* icon - refresh */}
                            <span>🗑 Clear settings and local storage</span>
                          </button>

                          <button
                            type="button"
                            className="menu-item"
                            role="menuitem"
                            onClick={() => { setSettingsOpen(false); onConfigEditorClick(); }}
                          >
                            {/* icon - pencil (edit) */}
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                              <path d="M12 20h9"></path>
                              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                            <span>Edit Settings</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* User dropdown */}
                    <div className="utility" ref={userMenuRef}>
                      <button
                        type="button"
                        className="utility-btn"
                        aria-haspopup="true"
                        aria-expanded={userMenuOpen}
                        aria-label="User menu"
                        onClick={() => setUserMenuOpen((s) => !s)}
                      >
                        {/* user svg — similar a TopNavigation (outline, usa currentColor) */}
                        <svg className="utility-icon user-svg" xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                          <path d="M20 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                          <path d="M4 21v-2a4 4 0 0 1 3-3.87" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                          <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                        </svg>

                        <span className="utility-username">{user?.signInDetails?.loginId || user?.username}</span>
                      </button>


                      {userMenuOpen && (
                        <div className="dropdown-menu" role="menu" aria-label="User menu">
                          <button type="button" className="menu-item" role="menuitem" onClick={() => { setUserMenuOpen(false); handleLogout(); }}>
                            {/* logout icon */}
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                              <path d="M16 17l5-5-5-5"></path>
                              <path d="M21 12H9"></path>
                            </svg>
                            <span>Logout</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

  
              {/* Messages area (scrollable). 'messages-pane' wrapper asegura que el scroll se limite aquí. */}
              <div className="messages-pane">
                <div className="messages-container scrollable" role="log" aria-live="polite">
                  {messages.length === 0 && (
                    <div className="messages-empty">
                      <div>There are no messages yet. Start the conversation by typing below.</div>
                    </div>
                  )}
  
                  {messages.map((message, index) => (
                    <div key={index} className="message-row">
                      <ChatBubble
                        ariaLabel={`${message.sender} message`}
                        type={ (message.outgoing === true) || (message.sender === user.username) ? "outgoing" : "incoming" }
                        avatar={
                          <Avatar
                            ariaLabel={message.sender}
                            tooltipText={message.sender === userIdForMessages ? userIdForMessages : message.sender}
                            color={message.sender === userIdForMessages ? "default" : "gen-ai"}
                            initials={
                              // Para el usuario, mostrar iniciales de la parte local del email si existe
                              message.sender === userIdForMessages
                                ? (String(userIdForMessages || '').split('@')[0].substring(0,2) || '').toUpperCase()
                                : String(message.sender || '').substring(0, 2).toUpperCase()
                            }
                          />
                        }
                      >
                        <div className="message-content">
                          {String(message.text || '').split('\n').map((line, i) => (
                            <ReactMarkdown
                              key={'md-rendering' + i}
                              rehypePlugins={[rehypeRaw]}
                            >
                              {line}
                            </ReactMarkdown>
                          ))}
                        </div>
                      </ChatBubble>
                    </div>
                  ))}
  
                  <div ref={messagesEndRef} />
                </div>
  
                {/* Agent-processing indicator (permanece debajo del scroll) */}
                {isAgentResponding && (
                  <div className="agent-indicator">
                    <LiveRegion>
                      <Box margin={{ bottom: "xs", left: "l" }} color="text-body-secondary">
                        {!isStrandsAgent && tasksCompleted.count > 0 && (
                          <div>
                            {agentName.value} is working on your request | Tasks completed ({tasksCompleted.count})
                            <br />
                            <i>{tasksCompleted.latestRationale}</i>
                          </div>
                        )}
                        {isStrandsAgent && (
                          <div>{agentName.value} is processing your request...</div>
                        )}
                        <LoadingBar variant="gen-ai" />
                      </Box>
                    </LiveRegion>
                  </div>
                )}
              </div>
  
              {/* Message input / footer */}
              <form onSubmit={handleSubmit} className="message-form" aria-label="Formulario de mensaje">
                <Form>
                  <FormField stretch>
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <button
                        type="button"
                        onClick={isListening ? stopListening : startListening}
                        title={isListening ? "Stop Listening" : "Start Listening"}
                        className="mic-button"
                        hidden={!speechRecognitionSupported}
                        aria-pressed={isListening}
                      >
                        {isListening ? (
                          <svg xmlns="http://www.w3.org/2000/svg" height="28" width="28" fill="red" viewBox="0 0 24 24">
                            <path d="M12 14q-1.25 0-2.125-.875T9 11V5q0-1.25.875-2.125T12 2q1.25 0 2.125.875T15 5v6q0 1.25-.875 2.125T12 14Zm-1 7v-3.1q-2.875-.35-4.437-2.35Q5 13.55 5 11h2q0 2.075 1.463 3.538Q9.925 16 12 16q2.075 0 3.538-1.462Q17 13.075 17 11h2q0 2.55-1.563 4.55-1.562 2-4.437 2.35V21Z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" height="28" width="28" fill="black" viewBox="0 0 24 24">
                            <path d="M12 14q-1.25 0-2.125-.875T9 11V5q0-1.25.875-2.125T12 2q1.25 0 2.125.875T15 5v6q0 1.25-.875 2.125T12 14Zm-1 7v-3.1q-2.875-.35-4.437-2.35Q5 13.55 5 11h2q0 2.075 1.463 3.538Q9.925 16 12 16q2.075 0 3.538-1.462Q17 13.075 17 11h2q0 2.55-1.563 4.55-1.562 2-4.437 2.35V21Z" />
                          </svg>
                        )}
                      </button>
  
                      <div style={{ flex: 1 }}>
                        <PromptInput
                          type='text'
                          value={newMessage}
                          onChange={({ detail }) => setNewMessage(detail.value)}
                          placeholder='Type your question here...'
                          actionButtonAriaLabel="Send message"
                          actionButtonIconName="send"
                        />
                      </div>
                    </div>
                  </FormField>
                </Form>
              </form>
  

              <Modal
                onDismiss={() => setShowNewChatModal(false)}
                visible={showNewChatModal}
                header="Create a new chat"
                closeAriaLabel="Cerrar"
                footer={
                  <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button variant="link" onClick={() => setShowNewChatModal(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        loading={loadingNewChat}
                        onClick={handleConfirmCreate}
                      >
                        Create chat
                      </Button>
                    </SpaceBetween>
                  </Box>
                }
              >
                <FormField
                  label="New chat's name"
                  description="This name will be used to identify your chat in the database."
                >
                  <Input
                    placeholder="Write a new name..."
                    value={chatName}
                    onChange={(e) => setChatName(e.detail.value)}
                  />
                </FormField>
              </Modal>
  
              <Modal
                onDismiss={() => setShowClearDataModal(false)}
                visible={showClearDataModal}
                header="Confirm clearing data"
                footer={
                  <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button variant="link" onClick={() => setShowClearDataModal(false)}>Cancel</Button>
                      <Button variant="primary" onClick={confirmClearData}>Ok</Button>
                    </SpaceBetween>
                  </Box>
                }
              >
                <strong>This action cannot be undone.</strong> Configuration for this application will be deleted along with the chat history with {agentName.value}. Do you want to continue?
              </Modal>


              {/* Modal para editar nombre de chat */}
              <Modal
                onDismiss={() => setEditModalOpen(false)}
                visible={editModalOpen}
                header="Edit chat name"
                closeAriaLabel="Close"
                footer={
                  <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button variant="link" onClick={() => setEditModalOpen(false)}>Cancel</Button>
                      <Button variant="primary" onClick={confirmEditChat}>Save</Button>
                    </SpaceBetween>
                  </Box>
                }
              >
                <FormField label="Chat name" description="Write the new name.">
                  <Input
                    placeholder="Chat name..."
                    value={editChatName}
                    onChange={(e) => setEditChatName(e.detail.value)}
                    aria-label="Chat name"
                  />
                </FormField>
              </Modal>


              {/* Modal de confirmación para eliminar chat */}
              <Modal
                onDismiss={cancelDeleteChat}
                visible={showDeleteChatModal}
                header="Confirm deletion"
                closeAriaLabel="Close"
                footer={
                  <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button variant="link" onClick={cancelDeleteChat} disabled={Boolean(deletingChatId)}>
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        loading={Boolean(deletingChatId)}
                        onClick={confirmDeleteChat}
                      >
                        Delete
                      </Button>
                    </SpaceBetween>
                  </Box>
                }
              >
                <div style={{ minWidth: 320 }}>
                  <p>
                    Are you sure you want to delete the chat?
                    {chatToDelete?.chatName ? ` «${chatToDelete.chatName}»` : ''}?
                    This action will delete the chat and all related messages.
                  </p>
                  <p style={{ fontSize: '0.9rem', color: '#666' }}>
                    This operation is irreversible.
                  </p>
                </div>
              </Modal>

            </main>
          </div>
        </div>
      </div>
    );
  })()

};

ChatComponent.propTypes = {
  user: PropTypes.object.isRequired,
  onLogout: PropTypes.func.isRequired,
  onConfigEditorClick: PropTypes.func.isRequired
};

export default ChatComponent;