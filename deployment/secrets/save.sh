#!/bin/bash

kubectl apply -f ./gen.secrets-coach-staging.yml
kubectl apply -f ./gen.secrets-coach-production.yml
