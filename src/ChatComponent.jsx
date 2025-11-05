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

  // ----- fetchUserChats: obtiene lista de chats del backend
  const fetchUserChats = async () => {
    setLoadingChats(true);
    try {
      const token = await getAuthToken();
      const email = await getUserEmail();

      // Intentar llamar con Authorization primero; si backend necesita email como query param, pasarlo también
      let url = API_URL; // asumes API_URL apunta a .../chats (según tu uso en handleConfirmCreate)
      if (email && !url.includes('?')) {
        url = `${url}?email=${encodeURIComponent(email)}`; // fallback amigable
      }

      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!resp.ok) {
        console.warn('fetchUserChats: respuesta no OK', resp.status);
        setChats([]);
        return;
      }

      const data = await resp.json();
      // Esperamos que el endpoint devuelva un array de items tipo { chatId, chatName, createdAt }
      // Si devuelve items estilo Dynamo (PK/SK), transformamos
      if (Array.isArray(data)) {
        setChats(data.map(item => ({
          chatId: item.chatId || (item.SK || '').replace(/^CHAT#/, ''),
          chatName: item.chatName || item.chatName || (item.chatName ? item.chatName : 'Chat sin nombre'),
          createdAt: item.createdAt || item.createdAt
        })));
      } else if (data.Items) {
        // si devolviera un objeto con "Items"
        setChats(data.Items.map(it => ({
          chatId: it.SK?.replace(/^CHAT#/, '') || it.chatId,
          chatName: it.chatName || it.title || 'Chat',
          createdAt: it.createdAt
        })));
      } else {
        setChats([]);
      }
    } catch (err) {
      console.error('fetchUserChats error:', err);
      setChats([]);
    } finally {
      setLoadingChats(false);
    }
  };

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
    if (!newMessage.trim() || !sessionId) return;

    // Lee appConfig si lo necesitas para otras cosas (no obligatorio aquí)
    const appConfig = JSON.parse(localStorage.getItem('appConfig') || '{}');

    // Helper interno: envia mensaje al API Gateway del agente (hardcode endpoint)
    const sendToAgentEndpoint = async ({ sessionId, message }) => {
      const endpoint = 'https://z2a5hwfq92.execute-api.us-east-1.amazonaws.com/production/chat';
      const headers = { 'Content-Type': 'application/json' };

      // Intento de extraer un idToken de Cognito/Amplify para Authorization Bearer (opcional)
      try {
        const AuthModule = await ensureAuthModule().catch(() => null);
        if (AuthModule) {
          let token = null;
          try {
            // distintos formatos según la versión de Amplify
            if (typeof AuthModule.currentSession === 'function') {
              // Amplify vX possible shape
              const sess = await AuthModule.currentSession();
              token = (sess?.getIdToken && typeof sess.getIdToken === 'function' && sess.getIdToken().getJwtToken && sess.getIdToken().getJwtToken())
                || sess?.idToken?.jwtToken
                || (sess?.tokens && sess.tokens.idToken);
            } else if (typeof AuthModule.fetchAuthSession === 'function') {
              // Otra posible API
              const f = await AuthModule.fetchAuthSession();
              token = f?.tokens?.idToken || f?.idToken?.jwtToken || f?.idToken;
            } else if (AuthModule?.currentAuthenticatedUser) {
              // Fallback: obtener sesión desde currentAuthenticatedUser (menos habitual)
              try {
                const cu = await AuthModule.currentAuthenticatedUser();
                // some flows attach signInUserSession
                token = cu?.signInUserSession?.idToken?.jwtToken || cu?.idToken?.jwtToken;
              } catch (e) {
                // ignore
              }
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

      // Construir body que espera el endpoint
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
        // intentar leer cuerpo para diagnóstico
        const txt = await resp.text().catch(() => '');
        throw new Error(`Agent API error ${resp.status}: ${txt}`);
      }

      // parseo seguro de JSON
      let data = null;
      try {
        data = await resp.json();
      } catch (err) {
        console.warn('sendToAgentEndpoint: respuesta no es JSON, devolviendo texto crudo.', err);
        const txt = await resp.text().catch(() => '');
        return txt || '';
      }

      // Soportar varias formas de respuesta comunes
      const reply = data?.reply || data?.response || data?.text || data?.message || (typeof data === 'string' ? data : JSON.stringify(data));
      return reply;
    };

    // Helper para maskear secretos en logs si lo necesitas
    const mask = (s = '') => {
      if (!s) return '(empty)';
      const str = String(s);
      if (str.length <= 8) return `${str.slice(0, 2)}...${str.slice(-2)}`;
      return `${str.slice(0, 4)}...${str.slice(-4)}`;
    };

    // Clear input field (UX)
    const originalMessage = newMessage;
    setNewMessage('');

    // obtener id consistente del usuario (preferimos el email que guardamos en userIdForMessages)
    let senderId = userIdForMessages;
    if (!senderId) {
      try { senderId = await getUserEmail() || user?.username; } catch (e) { senderId = user?.username; }
    }

    // userMessage ahora usa el mismo senderId que guardaremos en backend
    const userMessage = { text: originalMessage, sender: senderId || user?.username };
    setMessages(prev => [...prev, userMessage]);
    setIsAgentResponding(true);

    try {
      // Invocar endpoint del agente
      console.groupCollapsed('handleSubmit -> invoking external agent endpoint');
      console.log('sessionId:', sessionId);
      console.log('user:', user?.username);
      console.log('message preview:', originalMessage.slice(0, 200));

      const replyText = await sendToAgentEndpoint({ sessionId, message: originalMessage });

      console.log('agent reply (preview):', (typeof replyText === 'string' ? replyText.slice(0, 500) : JSON.stringify(replyText).slice(0, 500)));

      const agentMessage = { text: replyText, sender: agentName.value || 'Agent' };

      // 🟢 Obtener y mostrar el email del usuario autenticado
      let email;
      let AuthModule;

      try {
        AuthModule = await ensureAuthModule();
        console.log('AuthModule resolved:', AuthModule);
        console.log('AuthModule keys:', Object.keys(AuthModule || {}));
      } catch (authErr) {
        console.error('No se pudo resolver el módulo Auth:', authErr);
        return; // abortar si no hay Auth disponible
      }
      
      try {
        const { getCurrentUser } = AuthModule;
        if (getCurrentUser) {
          const user = await getCurrentUser();
          email = user?.signInDetails?.loginId || user?.username || "desconocido";
        } else {
          console.warn("getCurrentUser no está disponible en AuthModule.");
        }
      } catch (emailErr) {
        console.error("❌ Error obteniendo email del usuario:", emailErr);
      }

      // Guardar mensaje del usuario (usa senderId consistente)
      await storeMessage({ chatId: sessionId, message: originalMessage, sender: senderId });

      // Guardar la respuesta del agente conservando el agentName
      await storeMessage({ chatId: sessionId, message: replyText, sender: agentName.value || "Agent" });

      // Append agent message and persist both user+agent messages
      setMessages(prev => [...prev, agentMessage]);
      storeMessages(sessionId, [userMessage, agentMessage]);

      console.groupEnd();
    } catch (err) {
      console.error('Error invoking external agent endpoint:', {
        name: err?.name,
        message: err?.message,
        stack: err?.stack
      });

      const errReason = "**" + String(err) + "**";
      const errorMessage = { text: `An error occurred while processing your request:\n${errReason}`, sender: 'agent' };
      setMessages(prev => [...prev, errorMessage]);
      storeMessages(sessionId, [userMessage, errorMessage]);
    } finally {
      setIsAgentResponding(false);
      // reset any task-tracking UI state you used antes
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
  

  // Eliminar chat (local + backend)
  const handleDeleteChat = async (chat) => {
    setMenuOpenFor(null);
    const confirmed = window.confirm('¿Eliminar este chat? Esta acción eliminará el chat localmente.');
    if (!confirmed) return;

    // Eliminar local
    setChats(prev => prev.filter(x => x.chatId !== chat.chatId));
    localStorage.removeItem(`messages_${chat.chatId}`);

    // Si el chat eliminado estaba seleccionado, limpiar
    if (selectedChat?.chatId === chat.chatId) {
      setSelectedChat(null);
      setSessionId(null);
      setMessages([]);
    }

    // Intento de DELETE backend si existe
    try {
      const token = await getAuthToken().catch(() => null);
      await fetch(`${API_URL}/${chat.chatId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }).catch(() => {});
    } catch (err) {
      console.debug('DELETE chat fallback error:', err);
    }
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
                      const q = e.target.value.toLowerCase();
                      setChats(prev => prev.map(c => ({ ...c, _visible: String(c.chatName || '').toLowerCase().includes(q) })));
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
              {/* Top navigation (Cloudscape) */}
              <div className="topnav-wrapper">
                <TopNavigation
                  identity={{
                    title: `Chat with Nova Micro`,
                  }}
                  utilities={
                    [
                      {
                        type: "menu-dropdown",
                        iconName: "settings",
                        ariaLabel: "Settings",
                        title: "Settings",
                        disableUtilityCollapse: true,
                        onItemClick: ({ detail }) => {
                          switch (detail.id) {
                            case "edit-settings":
                              onConfigEditorClick();
                              break;
                            case "clear-settings":
                              handleClearData();
                              break;
                          }
                        },
                        items: [
                          {
                            id: "clear-settings",
                            type: "button",
                            iconName: "remove",
                            text: "Clear settings and local storage",
                          },
                          {
                            id: "edit-settings",
                            text: "Edit Settings",
                            iconName: "edit",
                            type: "icon-button",
                          }
                        ]
                      },
                      {
                        type: "menu-dropdown",
                        text: user.signInDetails?.loginId || user.username,
                        iconName: "user-profile",
                        title: user.signInDetails?.loginId || user.username,
                        ariaLabel: "User",
                        disableUtilityCollapse: true,
                        onItemClick: ({ detail }) => {
                          switch (detail.id) {
                            case "logout":
                              handleLogout();
                              break;
                          }
                        },
                        items: [
                          {
                            id: "logout",
                            text: "Logout",
                            iconName: "exit",
                            type: "icon-button",
                          }
                        ]
                      }
                    ]
                  }
                />
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
                        type={message.sender === user.username ? "outgoing" : "incoming"}
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
                header="Editar nombre del chat"
                closeAriaLabel="Cerrar"
                footer={
                  <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button variant="link" onClick={() => setEditModalOpen(false)}>Cancel</Button>
                      <Button variant="primary" onClick={confirmEditChat}>Save</Button>
                    </SpaceBetween>
                  </Box>
                }
              >
                <FormField label="Nombre del chat" description="Escribe el nuevo nombre.">
                  <Input
                    placeholder="Nombre del chat..."
                    value={editChatName}
                    onChange={(e) => setEditChatName(e.detail.value)}
                    aria-label="Nombre del chat"
                  />
                </FormField>
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