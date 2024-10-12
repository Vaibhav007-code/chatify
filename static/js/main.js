// DOM Elements
const elements = {
  themeToggle: document.getElementById('theme-toggle'),
  body: document.body,
  messageInput: document.getElementById('message-input'),
  messageList: document.getElementById('message-list'),
  mediaUpload: document.getElementById('media-upload'),
  sendMessageButton: document.getElementById('send-message'),
  mediaSendButton: document.getElementById('media-send'),
  voiceMessageButton: document.getElementById('voice-message'),
  userList: document.getElementById('online-users'),
  chatHeaderRecipient: document.getElementById('chat-header-recipient'),
  chatContainer: document.querySelector('.chat-container')
};

// State
let currentRecipient = null;
let socket;
let mediaRecorder;
let audioChunks = [];

// Initialize app
function initializeApp() {
  socket = io.connect('http://' + document.domain + ':' + location.port, {
    transports: ['websocket']
  });
  console.log('Socket connected:', socket.connected);
  setupEventListeners();
  setupWebSocketListeners();
  enableMessaging();
}

// Event listeners setup
function setupEventListeners() {
  elements.userList.addEventListener('click', handleUserSelection);
  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.sendMessageButton.addEventListener('click', handleSendMessage);
  elements.mediaSendButton.addEventListener('click', () => elements.mediaUpload.click());
  elements.mediaUpload.addEventListener('change', handleMediaUpload);
  elements.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendMessage();
  });

  // Voice message recording
  elements.voiceMessageButton.addEventListener('mousedown', startVoiceRecording);
  elements.voiceMessageButton.addEventListener('mouseup', stopVoiceRecording);
  elements.voiceMessageButton.addEventListener('mouseleave', stopVoiceRecording);
  elements.voiceMessageButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startVoiceRecording();
  });
  elements.voiceMessageButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopVoiceRecording();
  });
}

// WebSocket listeners setup
function setupWebSocketListeners() {
  socket.on('connect', () => {
    console.log('WebSocket connected');
    const username = sessionStorage.getItem('username');
    socket.emit('user_connected', username);
  });

  socket.on('new_message', handleNewMessage);
  socket.on('online_users', updateOnlineUsers);
  socket.on('user_connected', (username) => {
    console.log(`${username} connected`);
    addUserToList(username);
  });
}

// Enable messaging
function enableMessaging() {
  elements.messageInput.disabled = false;
  elements.sendMessageButton.disabled = false;
  elements.mediaSendButton.disabled = false;
  elements.voiceMessageButton.disabled = false;
}

// User selection handler
function handleUserSelection(event) {
  const userItem = event.target.closest('li');
  if (!userItem) return;

  const username = userItem.dataset.username;
  selectUserForChat(username);
}

// Select user for chat
function selectUserForChat(username) {
  currentRecipient = username;
  
  // Update UI
  document.querySelectorAll('#online-users li').forEach(user => {
    user.classList.remove('selected', 'new-message');
    user.removeAttribute('title');
    if (user.dataset.username === username) {
      user.classList.add('selected');
    }
  });
  
  // Update chat header
  elements.chatHeaderRecipient.textContent = `Chatting with: ${username}`;
  
  // Show chat container and clear message list
  elements.chatContainer.style.display = 'block';
  elements.messageList.innerHTML = '';
  
  loadMessagesForUser(currentRecipient);
}

// Theme toggling
function toggleTheme() {
  elements.body.classList.toggle('dark-mode');
  elements.body.classList.toggle('light-mode');
  elements.themeToggle.textContent = elements.body.classList.contains('dark-mode') ? '🌙' : '☀️';
}

// Send message handler
function handleSendMessage() {
  const messageText = elements.messageInput.value.trim();
  const currentUser = sessionStorage.getItem('username');

  // Prevent sending messages to self
  if (currentRecipient === currentUser) {
    alert("You cannot send a message to yourself.");
    return;
  }

  if (messageText && currentRecipient) {
    sendMessage(messageText);
    elements.messageInput.value = '';  // Clear the input field after sending
  } else if (!currentRecipient) {
    alert("Please select a user to send the message.");
  }
}

// Media upload handler
function handleMediaUpload(event) {
  const file = event.target.files[0];
  if (file && currentRecipient) {
    const fileType = file.type.split('/')[0];
    sendMessage('', file, fileType);
  } else if (!currentRecipient) {
    alert("Please select a user to send the media.");
  }
}

// Voice message recording
function startVoiceRecording() {
  if (!currentRecipient) {
    alert("Please select a user to send the voice message.");
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.start();
      audioChunks = [];

      mediaRecorder.addEventListener("dataavailable", event => {
        audioChunks.push(event.data);
      });

      // Stop recording after 60 seconds
      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          stopVoiceRecording();
        }
      }, 60000);
    });
}

// Stop voice recording
function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    mediaRecorder.addEventListener("stop", () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
      sendMessage('', audioBlob, 'audio');
    });
  }
}

// Handle new message received
function handleNewMessage(data) {
  console.log('Received new message:', data);
  const currentUser = sessionStorage.getItem('username');
  
  if (data.recipient === currentUser || data.sender === currentUser) {
    // Add message to UI
    addMessage(data);

    // Show notification if the message is received
    if (data.recipient === currentUser) {
      showNotification(data.sender, data.content);
      updateUserListWithNewMessage(data.sender);
    }

    // Update chat if the current recipient is the sender of the new message
    if (data.sender === currentRecipient) {
      loadMessagesForUser(currentRecipient);
    }
  }
}

// Function to show desktop notification
function showNotification(sender, message) {
  if (Notification.permission === "granted") {
    new Notification(`New message from ${sender}`, { body: message });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        new Notification(`New message from ${sender}`, { body: message });
      }
    });
  }
}

// Function to update user list with new message indicator
function updateUserListWithNewMessage(sender) {
  const userItem = document.querySelector(`#online-users li[data-username="${sender}"]`);
  if (userItem) {
    userItem.classList.add('new-message');
    userItem.setAttribute('title', 'New message');
  }
}

// UI functions
function addMessage(data) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', data.sender === sessionStorage.getItem('username') ? 'sent' : 'received');

  let messageContent = '';
  if (data.media_type && data.media_path) {
    if (data.media_type === 'image') {
      messageContent = `<img src="${data.media_path}" alt="Image" style="max-width: 200px; max-height: 200px;">`;
    } else if (data.media_type === 'audio') {
      messageContent = `<audio controls><source src="${data.media_path}" type="audio/ogg"></audio>`;
    } else if (data.media_type === 'video') {
      messageContent = `<video controls style="max-width: 200px; max-height: 200px;"><source src="${data.media_path}" type="video/mp4"></video>`;
    }
  }
  messageContent += `<p>${data.content}</p>`;
  messageContent += `<small>${new Date(data.timestamp).toLocaleString()}</small>`;

  messageElement.innerHTML = messageContent;
  elements.messageList.appendChild(messageElement);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

// Update online users list
function updateOnlineUsers(users) {
  elements.userList.innerHTML = '';
  users.forEach(addUserToList);
}

// Add user to list
function addUserToList(username) {
  const currentUser = sessionStorage.getItem('username');
  if (username === currentUser) return; // Don't add self to the list
  const userItem = document.createElement('li');
  userItem.dataset.username = username;
  userItem.textContent = username;
  elements.userList.appendChild(userItem);
}

// Network functions
function sendMessage(text, file = null, fileType = null) {
  const formData = new FormData();
  formData.append('message', text);
  formData.append('recipient', currentRecipient);
  
  if (file) {
    formData.append('media', file);
    formData.append('mediaType', fileType);
  }

  // Create a message object
  const message = {
    sender: sessionStorage.getItem('username'),
    recipient: currentRecipient,
    content: text,
    media_type: fileType,
    media_path: file ? URL.createObjectURL(file) : null,
    timestamp: new Date().toISOString()
  };

  // Emit the message via WebSocket
  socket.emit('new_message', message);
  console.log('Emitted new message:', message);

  // Immediately add the message to the chat box for the sender
  addMessage(message);

  fetch('/send_message', {
    method: 'POST',
    body: formData,
  })
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        console.log('Message sent successfully:', data.message);
      } else {
        console.error('Error sending message:', data.message);
      }
    })
    .catch(err => {
      console.error('Fetch error:', err);
    });
}

// Load messages for user
function loadMessagesForUser(recipient) {
  fetch(`/get_messages/${recipient}`)
    .then(response => response.json())
    .then(messages => {
      elements.messageList.innerHTML = '';
      messages.forEach(addMessage);
    })
    .catch(err => {
      console.error('Error loading messages:', err);
    });
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);