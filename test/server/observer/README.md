# Observer Guide

This module is used to monitor the MongoDB operations log (oplog) and fire off custom events based on those operations.  By doing this we can easily setup rules that listen for specific events and start Flows or do other actions based on those events.