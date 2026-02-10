# -*- coding: utf-8 -*-
from garminconnect import (
    Garmin, GarminConnectConnectionError, GarminConnectTooManyRequestsError, GarminConnectAuthenticationError
)

username = "achim@achimsweb.de"
password = "HA3297VFsdt54"

client = Garmin(username, password)
client.login()

activities = client.get_activities(0, 5)  # letzte 5 Aktivitäten
for a in activities:
    print(a["activityName"], a["distance"], a["duration"])
