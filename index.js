// Deps
const levelup = require('levelup');
const slack = require('@slack/client');
const RtmClient = slack.RtmClient;
const RTM_EVENTS = slack.RTM_EVENTS;

// Config
const config = require('./config');
const token = config.SLACK_API_TOKEN || '';
const parsingChannel = config.SLACK_PARSING_CHANNEL || '';

// Client
const rtm = new RtmClient(token);

// Start db
levelup('./mydb', (err, db) => {

  if (err) throw err;

  // Start slack client
  rtm.start();

  // Events
  rtm.on(RTM_EVENTS.MESSAGE, function (message) {
    const channel = rtm.dataStore.getChannelGroupOrDMById(message.channel);
    const channelName = channel.name;

    if (channelName !== parsingChannel) {
      return;
    }

    if (!message.text) {
      return;
    }

    // штрафы
    if (message.text.toLowerCase().trim() === 'штрафы') {
      const badUsers = [];
      const preferredStringLength = 25;

      db.createReadStream()
        .on('data', function (data) {
          badUsers.push({
            name: rtm.dataStore.getUserById(data.key)
                    .profile.real_name_normalized,
            value: data.value
          });
        })
        .on('error', function (err) {
          throw err;
        })
        .on('end', function () {

          const each = badUsers
            .sort(({ value: a }, { value: b }) => {
              if (a > b) return 1;
              if (a < b) return -1;
              return 0;
            })
            .map(o => {
              const valLength = o.value.toString().length;
              const formatSpace = Array(Math.max(preferredStringLength - o.name.length - 1 + (4 - valLength), 0)).join('.');
              return `${ o.name }:${ formatSpace }.${ o.value }`;
            })
            .join('\r\n');

          const totalString = 'Сумма всех штрафов';
          const totalFormatSpace = Array(Math.max(preferredStringLength - totalString.length - 1, 0)).join('.');
          const total = `${ totalString }:${ totalFormatSpace }.${
            badUsers.map(o => parseInt(o.value, 10)).reduce((t, c) => t+c, 0)
          }`;

          rtm.sendMessage(
            `\`\`\`${ each }\r\n${ total }\`\`\``,
            message.channel
          );
        });

      return;
    }

    // штраф
    if (~message.text.toLowerCase().indexOf('штраф')) {
      const parsedMsg = (/\<\@(.+)\>\s*(\d*)/).exec(message.text);
      if (!parsedMsg) {
        return;
      }

      const goodUser = rtm.dataStore.getUserById(message.user);
      const goodUserName = goodUser.profile.real_name_normalized;
      const badUser = rtm.dataStore.getUserById(parsedMsg[1]);
      const increment = Math.max(+parsedMsg[2], 50);

      if (badUser) {
        db.get(badUser.id, (getError, value) => {
          let parsedValue;
          let nextValue;

          if (getError) {
            if (getError.notFound) {
              parsedValue = 0;
            } else {
              throw getError;
            };
          } else {
            parsedValue = parseInt(value, 10);
          }

          nextValue = parsedValue + increment;

          db.put(badUser.id, nextValue, putError => {
            if (putError) throw putError;

            rtm.sendMessage(
              `Штрафую ${ badUser.profile.real_name_normalized } по приказу ${ goodUserName } :sadkitty:
Сумма твоих штрафов: ${ nextValue }.`,
              message.channel
            );
          });

        });
      }

      return;
    }
  });
});
