import os
import sys
import base64
import hashlib
import subprocess
from cryptography.fernet import Fernet

class Security:
    """Handles machine-specific key encryption and decryption."""
    
    _cached_key = None

    @classmethod
    def get_machine_id(cls) -> str:
        """Generates a reasonably unique hardware-linked ID for this device."""
        try:
            if sys.platform == "win32":
                # Get Windows UUID from registry/command
                cmd = 'wmic csproduct get uuid'
                uuid = subprocess.check_output(cmd, shell=True).decode().split('\n')[1].strip()
                if uuid: return uuid
            elif sys.platform == "darwin":
                # MacOS hardware UUID
                cmd = "ioreg -rd1 -c IOPlatformExpertDevice | grep -E '(IOPlatformUUID)'"
                uuid = subprocess.check_output(cmd, shell=True).decode().split('"')[-2]
                if uuid: return uuid
            else:
                # Linux machine-id
                if os.path.exists("/etc/machine-id"):
                    with open("/etc/machine-id", "r") as f:
                        return f.read().strip()
        except:
            pass
            
        # Fallback to a hash of the node (MAC address)
        import uuid as _uuid
        return str(_uuid.getnode())

    @classmethod
    def _get_fernet_key(cls) -> bytes:
        """Derives a Fernet-compatible key from the machine ID."""
        if cls._cached_key:
            return cls._cached_key
            
        machine_id = cls.get_machine_id()
        # Derive a 32-byte key using SHA256
        key_hash = hashlib.sha256(machine_id.encode()).digest()
        # Fernet keys must be base64-encoded 32-byte keys
        cls._cached_key = base64.urlsafe_b64encode(key_hash)
        return cls._cached_key

    @classmethod
    def encrypt(cls, data: str) -> str:
        """Encrypts a string using the machine-bound key."""
        if not data: return ""
        try:
            f = Fernet(cls._get_fernet_key())
            return f.encrypt(data.encode()).decode()
        except Exception as e:
            # Fallback if cryptography fails (unlikely)
            return data

    @classmethod
    def decrypt(cls, encrypted_data: str) -> str:
        """Decrypts a string using the machine-bound key."""
        if not encrypted_data: return ""
        try:
            # If it doesn't look like Fernet, return as is (for migration)
            if not encrypted_data.startswith("gAAAA"):
                return encrypted_data
                
            f = Fernet(cls._get_fernet_key())
            return f.decrypt(encrypted_data.encode()).decode()
        except:
            # If decryption fails, it might be raw data
            return encrypted_data
