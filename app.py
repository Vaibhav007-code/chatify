from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import sqlite3
from werkzeug.utils import secure_filename
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'  # Change this in production
socketio = SocketIO(app, cors_allowed_origins="*")

UPLOAD_FOLDER = 'static/uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'mp4', 'mp3', 'ogg'}

# Track online users
online_users = {}

def init_db():
    with sqlite3.connect('database.db') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER,
                recipient_id INTEGER,
                content TEXT,
                media_type TEXT,
                media_path TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id) REFERENCES users (id),
                FOREIGN KEY (recipient_id) REFERENCES users (id)
            )
        ''')
        conn.commit()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        action = request.form['action']

        with sqlite3.connect('database.db') as conn:
            cursor = conn.cursor()

            if action == 'login':
                cursor.execute('SELECT * FROM users WHERE username = ? AND password = ?', (username, password))
                user = cursor.fetchone()

                if user:
                    session['user_id'] = user[0]
                    session['username'] = username
                    return redirect(url_for('chat'))
                else:
                    return render_template('login.html', error="Invalid username or password.")

            elif action == 'signup':
                try:
                    cursor.execute('INSERT INTO users (username, password) VALUES (?, ?)', (username, password))
                    conn.commit()
                    return render_template('login.html', success="Account created successfully. Please log in.")
                except sqlite3.IntegrityError:
                    return render_template('login.html', error="Username already exists.")

    return render_template('login.html')

@app.route('/chat')
def chat():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('chat.html', username=session['username'])

@app.route('/send_message', methods=['POST'])
def send_message():
    if 'user_id' not in session:
        return jsonify({'status': 'fail', 'message': 'User not logged in'})

    sender_id = session['user_id']
    sender_username = session['username']
    content = request.form.get('message', '')
    recipient_username = request.form.get('recipient')

    # Prevent users from sending messages to themselves
    if sender_username == recipient_username:
        return jsonify({'status': 'fail', 'message': 'You cannot send a message to yourself.'})

    if not recipient_username:
        return jsonify({'status': 'fail', 'message': 'Recipient not specified'})

    file = request.files.get('media')
    media_type = None
    filename = None

    if file and allowed_file(file.filename):
        filename = secure_filename(f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{file.filename}")
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        media_type = file.mimetype.split('/')[0]

    with sqlite3.connect('database.db') as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT id FROM users WHERE username = ?', (recipient_username,))
        recipient_result = cursor.fetchone()

        if not recipient_result:
            return jsonify({'status': 'fail', 'message': 'Recipient not found'})

        recipient_id = recipient_result[0]
        cursor.execute('''
            INSERT INTO messages (sender_id, recipient_id, content, media_type, media_path)
            VALUES (?, ?, ?, ?, ?)
        ''', (sender_id, recipient_id, content, media_type, filename))

        message_id = cursor.lastrowid
        conn.commit()

    message_data = {
        'sender': sender_username,
        'recipient': recipient_username,
        'content': content,
        'media_type': media_type,
        'media_path': filename,
        'timestamp': datetime.now().isoformat()
    }

    # Emit message to recipient and sender
    socketio.emit('new_message', message_data, room=online_users.get(recipient_username))
    socketio.emit('new_message', message_data, room=online_users.get(sender_username))

    return jsonify({'status': 'success', 'message': message_data})

@app.route('/get_messages/<recipient>', methods=['GET'])
def get_messages(recipient):
    if 'user_id' not in session:
        return jsonify({'status': 'fail', 'message': 'User not logged in'})

    user_id = session['user_id']

    with sqlite3.connect('database.db') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT m.*, u1.username as sender_username, u2.username as recipient_username
            FROM messages m
            JOIN users u1 ON m.sender_id = u1.id
            JOIN users u2 ON m.recipient_id = u2.id
            WHERE (m.sender_id = ? AND m.recipient_id = (SELECT id FROM users WHERE username = ?))
            OR (m.sender_id = (SELECT id FROM users WHERE username = ?) AND m.recipient_id = ?)
            ORDER BY m.timestamp ASC
        ''', (user_id, recipient, recipient, user_id))

        messages = cursor.fetchall()

    formatted_messages = [
        {
            'sender': message[8],
            'recipient': message[9],
            'content': message[3],
            'media_type': message[4],
            'media_path': message[5],
            'timestamp': message[6]
        } for message in messages
    ]

    return jsonify(formatted_messages)

@app.route('/media/<filename>')
def media(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@socketio.on('connect')
def handle_connect():
    print("Client connected")
    if 'username' in session:
        username = session['username']
        online_users[username] = request.sid
        join_room(request.sid)  # Add this line
        emit('user_connected', username, broadcast=True)
        emit_online_users()
    print(f"Online users after connect: {online_users}")

@socketio.on('disconnect')
def handle_disconnect():
    print("Client disconnected")
    if 'username' in session:
        username = session['username']
        if username in online_users:
            del online_users[username]
        emit('user_disconnected', username, broadcast=True)
        emit_online_users()
    print(f"Online users after disconnect: {online_users}")

@socketio.on('user_connected')
def handle_user_connected(username):
    print(f"User connected: {username}")
    online_users[username] = request.sid
    emit('user_connected', username, broadcast=True)
    emit_online_users()
    print(f"Online users after user_connected: {online_users}")

@socketio.on('new_message')
def handle_new_message(message_data):
    print(f"Handling new message: {message_data}")
    print(f"Online users: {online_users}")
    
    # Store the message in the database
    with sqlite3.connect('database.db') as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE username = ?', (message_data['sender'],))
        sender_id = cursor.fetchone()[0]
        cursor.execute('SELECT id FROM users WHERE username = ?', (message_data['recipient'],))
        recipient_id = cursor.fetchone()[0]

        cursor.execute('''
            INSERT INTO messages (sender_id, recipient_id, content, media_type, media_path)
            VALUES (?, ?, ?, ?, ?)
        ''', (sender_id, recipient_id, message_data['content'], message_data.get('media_type'), message_data.get('media_path')))
        conn.commit()

    # Emit the message to both sender and recipient
    sender_sid = online_users.get(message_data['sender'])
    recipient_sid = online_users.get(message_data['recipient'])
    
    print(f"Sender SID: {sender_sid}, Recipient SID: {recipient_sid}")

    if sender_sid:
        print(f"Emitting to sender: {message_data['sender']}")
        emit('new_message', message_data, room=sender_sid)
    if recipient_sid:
        print(f"Emitting to recipient: {message_data['recipient']}")
        emit('new_message', message_data, room=recipient_sid)
    else:
        print(f"Recipient {message_data['recipient']} not found in online_users")

def emit_online_users():
    socketio.emit('online_users', list(online_users.keys()))

if __name__ == '__main__':
    init_db()
    socketio.run(app, debug=True)