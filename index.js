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

    // штрафы
    if (message.text.toLowerCase().trim() === 'штрафы') {
      const badUsers = [];
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
            .map(o => `${ o.name }: ${ o.value }`)
            .join('\r\n');

          const total = `Сумма всех штрафов: ${
            badUsers.map(o => parseInt(o.value, 10)).reduce((t, c) => t+c, 0)
          }`;

          rtm.sendMessage(
            `${ each }\r\n${ total }`,
            message.channel
          );
        });

      return;
    }

    // штраф
    if (~message.text.toLowerCase().indexOf('штраф')) {
      const badUserId = (/\<\@.+\>/).exec(message.text);
      if (!badUserId) {
        return;
      }

      const badUser = rtm.dataStore.getUserById(badUserId[0].slice(2, -1));

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

          nextValue = parsedValue + 50;

          db.put(badUser.id, nextValue, putError => {
            if (putError) throw putError;

            rtm.sendMessage(
              `Штрафую ${ badUser.profile.real_name_normalized } :sadkitty:
              Его/ее штрафы выросли до ${ nextValue }.`,
              message.channel
            );
          });

        });
      }

      return;
    }
  });
});
