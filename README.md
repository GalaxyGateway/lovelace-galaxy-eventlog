# HACS Lovelace group card
This card can be added through HACS.

In HACS add a custom repository:
```
  Set repository to: https://github.com/GalaxyGateway/lovelace-galaxy-eventlog
  Set category to: lovelace
```

Through the dashboard editor or manually add a card and set the below example config:
```
type: custom:lovelace-galaxy-eventlog
entity: sensor.galaxy_gateway_5b0438_event_5b0438
title: Event Log
max_events: 15
filter_codes: []
sia_colors: []
```

Optional:
```
sia_colors:
  - code: BA
    color: "#ef4444"
    label: Burglary Alarm
  - code: FA
    color: "#f97316"
    label: Fire Alarm
  - code: PA
    color: "#ef4444"
    label: Panic Alarm
  - code: TA
    color: "#f59e0b"
    label: Tamper
  - code: CA
    color: "#22c55e"
    label: Cancel
  - code: CL
    color: "#22c55e"
    label: Closing
  - code: OP
    color: "#3b82f6"
    label: Opening
  - code: RR
    color: "#22c55e"
    label: System Restore
```

The cards are ment to be used with the Galaxy Gateway module available from https://seasoft.nl

Other card available:
- Virtual keypad
- Group card

The cards provide a way to interface to a Honeywell Galaxy Dimension or Flex panel through the Galaxy Gateway module.

Other usefull cards:
- https://github.com/royto/logbook-card

<img width="898" height="605" alt="image" src="https://github.com/user-attachments/assets/b0bae587-d79e-419c-9f7e-2f156cdd5cb2" />
