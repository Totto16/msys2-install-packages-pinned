# MSYS2 installed packages pinned

`msys2-install-packages-pinned` is a GitHub Action (GHA) to install a certain pinned package from [MSYS2](https://www.msys2.org/) environment (i.e. gcc 14, when gcc 15 is the default)

This was created, since pacman (the package manager MSYS2 uses) doesn't support installing specific versions out of the box.


## Usage

```yaml
  - uses: Totto16/msys2-install-packages-pinned@v1
      with:
          msystem: MINGW64
          install: gcc=14 gcc-libs=!
```


### Options

#### msystem

* Type: `string`
* Allowed values: `MINGW64 | MINGW32 | UCRT64 | CLANG64 | CLANGARM64`
* Default: `MINGW64`
* Optional

The default [environment](https://www.msys2.org/docs/environments/) that is used in the `msys2` command/shell provided by this action.

MSYS2 recommends `UCRT64` nowadays as the default instead of `MINGW64`.

#### install

* Type: `string`
* Allowed values: See Syntax below
* Required

The packages to install, this can be a complicated string, wrapped around multiple lines, see the syntax below for more information.

##### Syntax

```html
All = (<Spec> \n)*

Spec = (<Package> <Space>)*

Space = ' '

Package = <Name>(<Equals> <PackageSettings>)?

Name = "A valid package name"

Equals = '='

PackageSettings = (<VersionSpecifier>)? (<Colon> <PackageResolveSettings>)?

Colon = ':'

PackageResolveSettings = (<PackageResolveSettingIsVirtual>)? (<PackageResolveSettingNoPrefix>)?

PackageResolveSettingIsVirtual = 'v' // sets the package as virtual package

PackageResolveSettingNoPrefix = 'n' // doesn't try to prepend the prefix 

VersionSpecifier = <SpecialVersionSpecifier> | <PartialSemverVersion>

SpecialVersionSpecifier = <SameAsRestVersionSpecifier>

SameAsRestVersionSpecifier = '!'

PartialSemverVersion = <Digits> (<Point> <Digits> (<Point> <Digits> (<Slash> <Digits>)? )? )?

Digits = <Digit> +

Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' 

Point = '.'

Slash = '-'
```

## Notes

A version can be a partial semver version or one of the special meanings, it also can be empty, which is equal to the newest one

You can install a few packages in the same pacman call, by sepewrating them by space, so that e.g. `gcc-libs` and `gcc` are installed in the same go.
Otherwise, you can seperate them with `\n` to install each one individually.

The PackageResolveSettings are settings, that apply to a package, these are by default:
add prefix and the package is not a virtual package. You can chnage it by adding one or more of the modifierer chars to the package name after the '=', see syntax for details.
