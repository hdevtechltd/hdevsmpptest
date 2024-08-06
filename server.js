const express = require('express');
const smpp = require('smpp');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const app = express();
const wss = new WebSocket.Server({ noServer: true });

app.use(bodyParser.json());
app.use(express.static('Public')); // Serve static files from the 'public' directory

// Function to parse the short message to get only the text portion
const parseShortMessage = (short_message) => {
  const parts = {};
  const regex = /(\w+):([^ ]+)/g;
  let match;

  // Loop through all matches
  while ((match = regex.exec(short_message)) !== null) {
    const key = match[1];
    const value = match[2];
    parts[key] = value;
  }

  // Extract text field separately as it may contain spaces
  const textMatch = short_message.match(/text:(.+)$/);
  if (textMatch) {
    parts.text = textMatch[1];
  }

  return parts;
};

app.post('/send-message', (req, res) => {
  const { host, port, system_id, password, source_addr, destination_addr, short_message } = req.body;

  if (!host || !port) {
    return res.status(400).send('Host and port are required.');
  }

  const session = new smpp.Session({
    host: host,
    port: parseInt(port, 10), // Ensure port is an integer
  });

  session.on('connect', () => {
    session.bind_transceiver({ system_id, password }, (pdu) => {
      if (pdu.command_status === 0) {
        wss.clients.forEach(client => client.send(JSON.stringify({
          type: 'info',
          message: 'SMPP bind successful',
          icon: '✔️'
        })));

        sendMessage(session, source_addr, destination_addr, short_message);

      } else {
        wss.clients.forEach(client => client.send(JSON.stringify({
          type: 'error',
          message: `SMPP bind failed: ${pdu.command_status}`,
          icon: '❌'
        })));
        res.status(500).send(`SMPP bind failed: ${pdu.command_status}`);
      }
    });
  });

  session.on('error', (error) => {
    wss.clients.forEach(client => client.send(JSON.stringify({
      type: 'error',
      message: `SMPP session error: ${error.message}`,
      icon: '❌'
    })));
    res.status(500).send(`SMPP session error: ${error.message}`);
  });

  session.on('close', () => {
    wss.clients.forEach(client => client.send(JSON.stringify({
      type: 'info',
      message: 'Connection closed',
      icon: '🔒'
    })));
  });

  function sendMessage(session, source_addr, destination_addr, short_message) {
    wss.clients.forEach(client => client.send(JSON.stringify({
      type: 'info',
      message: 'Sending message...',
      icon: '📩'
    })));
  
    session.submit_sm({
      source_addr,
      destination_addr,
      short_message,
      registered_delivery: 1 // Request delivery report
    }, (pdu) => {
      if (pdu.command_status === 0) {
        const formattedPDU = formatPDU(pdu);
        wss.clients.forEach(client => client.send(JSON.stringify({
          type: 'success',
          message_id: formattedPDU.message_id || 'undefined',
          status: 'Message submitted successfully',
          icon: '✔️'
        })));
  
        wss.clients.forEach(client => client.send(JSON.stringify({
          type: 'info',
          message: 'Waiting for delivery report...',
          icon: '⏳'
        })));
      } else {
        wss.clients.forEach(client => client.send(JSON.stringify({
          type: 'error',
          message: `Failed to submit message: ${pdu.command_status}`,
          icon: '❌'
        })));
      }
      // session.unbind();
    });

    session.on('deliver_sm', (pdu) => {
      const formattedPDU = formatPDU(pdu);
      const parsedMessage = parseShortMessage(formattedPDU.short_message);
      wss.clients.forEach(client => client.send(JSON.stringify({
        type: 'report',
        message_id: parsedMessage.id || 'undefined',
        status: parsedMessage.stat || 'undefined',
        source_addr: formattedPDU.source_addr || 'undefined',
        destination_addr: formattedPDU.destination_addr || 'undefined',
        short_message: parsedMessage.text || 'undefined',
        icon: '📈'
      })));
    });
  }
});

const formatPDU = (pdu) => {
  return {
    command_id: pdu.command_id,
    command_status: pdu.command_status,
    sequence_number: pdu.sequence_number,
    message_id: pdu.message_id,
    source_addr: pdu.source_addr,
    destination_addr: pdu.destination_addr,
    short_message: pdu.short_message ? pdu.short_message.message || pdu.short_message : '',
  };
};

const server = app.listen(4040, () => {
  console.log('Server is running on ' + server.address().port);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});